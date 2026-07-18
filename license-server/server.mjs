import { createHash, randomBytes, randomUUID, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const port = Number(process.env.LICENSE_PORT || 8787);
const dataDir = process.env.LICENSE_DATA_DIR || join(process.cwd(), 'license-data');
const adminToken = process.env.LICENSE_ADMIN_TOKEN || '';
const privateKey = (process.env.LICENSE_PRIVATE_KEY_PEM || '').replace(/\\n/g, '\n');
if (!adminToken || !privateKey) {
  throw new Error('Set LICENSE_ADMIN_TOKEN and LICENSE_PRIVATE_KEY_PEM before starting the license server.');
}
const databaseFile = join(dataDir, 'licenses.json');
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let database = await loadDatabase();

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true });
    if (request.method === 'GET' && url.pathname === '/admin') return html(response, adminPage);
    if (request.method === 'GET' && url.pathname === '/admin/deploy') return html(response, deploymentPage);
    if (request.method === 'GET' && (url.pathname === '/latest.yml' || url.pathname === '/latest-mac.yml')) return updateManifest(response, url.pathname);
    if (request.method === 'POST' && url.pathname === '/v1/licenses/activate') return activate(request, response);
    if (request.method === 'POST' && url.pathname === '/v1/licenses/deactivate') return deactivate(request, response);
    if (url.pathname.startsWith('/v1/admin/')) return admin(request, response, url);
    return json(response, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    return json(response, 500, { error: error instanceof Error ? error.message : 'INTERNAL_ERROR' });
  }
}).listen(port, () => console.log(`License server listening on :${port}`));

async function activate(request, response) {
  const { code, installationId } = await body(request);
  if (typeof code !== 'string' || typeof installationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(installationId)) return json(response, 400, { error: 'INVALID_REQUEST' });
  const record = database.codes.find((item) => item.hash === digest(code.toUpperCase()));
  if (!record) return json(response, 404, { error: 'LICENSE_CODE_INVALID' });
  if (record.revoked) return json(response, 403, { error: 'LICENSE_REVOKED' });
  if (record.installationId && record.installationId !== installationId) return json(response, 409, { error: 'LICENSE_DEVICE_LIMIT_REACHED' });
  record.installationId = installationId;
  record.activatedAt ||= new Date().toISOString();
  record.licenseId ||= randomUUID();
  await saveDatabase();
  return json(response, 200, signedLicense(record));
}

async function deactivate(request, response) {
  const { licenseId, installationId } = await body(request);
  const record = database.codes.find((item) => item.licenseId === licenseId && item.installationId === installationId);
  if (!record) return json(response, 404, { error: 'LICENSE_NOT_FOUND' });
  record.installationId = null; record.activatedAt = null; record.licenseId = null;
  await saveDatabase();
  return json(response, 200, { ok: true });
}

async function admin(request, response, url) {
  if (request.headers.authorization !== `Bearer ${adminToken}`) return json(response, 401, { error: 'ADMIN_UNAUTHORIZED' });
  if (request.method === 'GET' && url.pathname === '/v1/admin/codes') return json(response, 200, { codes: database.codes.map(publicRecord) });
  if (request.method === 'GET' && url.pathname === '/v1/admin/releases') return json(response, 200, { releases: database.releases });
  if (request.method === 'POST' && url.pathname === '/v1/admin/releases') {
    const { version, platform, path, sha512, releaseNotes = '' } = await body(request);
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(String(version)) || !['win', 'mac'].includes(platform) || !/^[A-Za-z0-9._/-]+$/.test(String(path)) || typeof sha512 !== 'string' || sha512.length < 32) return json(response, 400, { error: 'INVALID_RELEASE' });
    database.releases = database.releases.filter((item) => item.platform !== platform);
    database.releases.push({ version, platform, path, sha512, releaseNotes: String(releaseNotes).slice(0, 1000), publishedAt: new Date().toISOString(), enabled: true });
    await saveDatabase(); return json(response, 201, { release: database.releases.at(-1) });
  }
  const releaseMatch = url.pathname.match(/^\/v1\/admin\/releases\/(win|mac)\/(enable|disable)$/);
  if (request.method === 'POST' && releaseMatch) {
    const release = database.releases.find((item) => item.platform === releaseMatch[1]);
    if (!release) return json(response, 404, { error: 'RELEASE_NOT_FOUND' });
    release.enabled = releaseMatch[2] === 'enable'; await saveDatabase(); return json(response, 200, { release });
  }
  if (request.method === 'POST' && url.pathname === '/v1/admin/codes') {
    const { quantity, note = '' } = await body(request);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) return json(response, 400, { error: 'INVALID_QUANTITY' });
    const created = Array.from({ length: quantity }, () => {
      const code = createCode();
      const record = { id: randomUUID(), hash: digest(code), note: String(note).slice(0, 200), createdAt: new Date().toISOString(), revoked: false, installationId: null, activatedAt: null, licenseId: null };
      database.codes.push(record); return { ...publicRecord(record), code };
    });
    await saveDatabase(); return json(response, 201, { codes: created });
  }
  const match = url.pathname.match(/^\/v1\/admin\/codes\/([a-f0-9]{64})\/(revoke|unbind)$/);
  if (request.method === 'POST' && match) {
    const record = database.codes.find((item) => item.hash === match[1]);
    if (!record) return json(response, 404, { error: 'LICENSE_NOT_FOUND' });
    if (match[2] === 'revoke') record.revoked = true;
    else { record.installationId = null; record.activatedAt = null; record.licenseId = null; }
    await saveDatabase(); return json(response, 200, { code: publicRecord(record) });
  }
  return json(response, 404, { error: 'NOT_FOUND' });
}

function updateManifest(response, pathname) {
  const platform = pathname === '/latest-mac.yml' ? 'mac' : 'win';
  const release = database.releases.find((item) => item.platform === platform && item.enabled);
  if (!release) { response.writeHead(404); return response.end(); }
  const yaml = `version: ${release.version}\nfiles:\n  - url: ${release.path}\n    sha512: ${release.sha512}\npath: ${release.path}\nsha512: ${release.sha512}\nreleaseDate: '${release.publishedAt}'\nreleaseNotes: ${JSON.stringify(release.releaseNotes)}\n`;
  response.writeHead(200, { 'content-type': 'text/yaml; charset=utf-8', 'cache-control': 'no-store' }); response.end(yaml);
}

function signedLicense(record) {
  const license = { licenseId: record.licenseId, installationId: record.installationId, issuedAt: new Date().toISOString() };
  return { license, signature: sign(null, Buffer.from(JSON.stringify(license)), privateKey).toString('base64') };
}
function createCode() { return `NC-${Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => alphabet[randomBytes(1)[0] % alphabet.length]).join('')).join('-')}`; }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function publicRecord(record) { const { hash, ...rest } = record; return { ...rest, codeHash: hash }; }
async function body(request) { let raw = ''; for await (const chunk of request) raw += chunk; try { return JSON.parse(raw || '{}'); } catch { return {}; } }
function json(response, status, data) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); }
function html(response, content) { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(content); }
async function loadDatabase() { try { const value = JSON.parse(await readFile(databaseFile, 'utf8')); return Array.isArray(value.codes) ? { codes: value.codes, releases: Array.isArray(value.releases) ? value.releases : [] } : { codes: [], releases: [] }; } catch { return { codes: [], releases: [] }; } }
async function saveDatabase() { await mkdir(dataDir, { recursive: true, mode: 0o700 }); const temporary = `${databaseFile}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(database), { mode: 0o600 }); await rename(temporary, databaseFile); }

const adminPage = `<!doctype html><meta charset="utf-8"><title>NoteChange 管理后台</title><style>body{font:14px system-ui;max-width:960px;margin:40px auto;padding:0 18px}input,button,textarea,select{font:inherit;padding:8px}table{width:100%;border-collapse:collapse;margin-top:20px}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}#created{white-space:pre-wrap;font-family:ui-monospace;color:#063}section{margin-top:36px;padding-top:18px;border-top:1px solid #ddd}</style><h1>NoteChange 管理后台</h1><p>永久激活码、设备绑定与版本发布。</p><div class="row"><input id="token" type="password" placeholder="管理员令牌"><button onclick="load()">刷新</button></div><section><h2>批量生成激活码</h2><div class="row"><input id="quantity" type="number" value="10" min="1" max="500"><input id="note" placeholder="批次备注"><button onclick="createCodes()">批量生成</button></div><pre id="created"></pre><table><thead><tr><th>创建时间</th><th>备注</th><th>状态</th><th>激活时间</th><th>操作</th></tr></thead><tbody id="rows"></tbody></table></section><section><h2>版本发布</h2><p>先将安装包与 blockmap 上传到更新服务器目录，再登记文件相对路径和 SHA-512。</p><div class="row"><input id="version" placeholder="版本，如 1.0.1"><select id="platform"><option value="win">Windows</option><option value="mac">macOS</option></select><input id="path" placeholder="NoteChange Setup 1.0.1.exe"><input id="sha512" placeholder="SHA-512"><input id="notes" placeholder="更新说明"><button onclick="publishRelease()">发布版本</button></div><table><thead><tr><th>平台</th><th>版本</th><th>文件</th><th>状态</th><th>操作</th></tr></thead><tbody id="releases"></tbody></table></section><script>const token=()=>document.querySelector('#token').value;const api=(path,opt={})=>fetch(path,{...opt,headers:{...opt.headers,authorization:'Bearer '+token(),'content-type':'application/json'}}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d});async function load(){try{const [d,r]=await Promise.all([api('/v1/admin/codes'),api('/v1/admin/releases')]);document.querySelector('#rows').innerHTML=d.codes.map(c=>'<tr><td>'+c.createdAt+'</td><td>'+c.note+'</td><td>'+ (c.revoked?'已禁用':c.installationId?'已激活':'未激活')+'</td><td>'+ (c.activatedAt||'')+'</td><td><button onclick="act(\\''+c.codeHash+'\\',\\'unbind\\')">解绑</button> <button onclick="act(\\''+c.codeHash+'\\',\\'revoke\\')">禁用</button></td></tr>').join('');document.querySelector('#releases').innerHTML=r.releases.map(x=>'<tr><td>'+x.platform+'</td><td>'+x.version+'</td><td>'+x.path+'</td><td>'+ (x.enabled?'已发布':'已停用')+'</td><td><button onclick="release(\\''+x.platform+'\\',\\''+(x.enabled?'disable':'enable')+'\\')">'+(x.enabled?'停用':'启用')+'</button></td></tr>').join('')}catch(e){alert(e.message)}}async function createCodes(){try{const d=await api('/v1/admin/codes',{method:'POST',body:JSON.stringify({quantity:+document.querySelector('#quantity').value,note:document.querySelector('#note').value})});document.querySelector('#created').textContent='请立即保存，激活码仅显示一次：\\n'+d.codes.map(c=>c.code).join('\\n');load()}catch(e){alert(e.message)}}async function act(hash,action){try{await api('/v1/admin/codes/'+hash+'/'+action,{method:'POST'});load()}catch(e){alert(e.message)}}async function publishRelease(){try{await api('/v1/admin/releases',{method:'POST',body:JSON.stringify({version:version.value,platform:platform.value,path:path.value,sha512:sha512.value,releaseNotes:notes.value})});load()}catch(e){alert(e.message)}}async function release(platform,action){try{await api('/v1/admin/releases/'+platform+'/'+action,{method:'POST'});load()}catch(e){alert(e.message)}}</script>`;
