import { createHash, randomBytes, randomUUID, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ensureLicenseConfiguration } from './key-store.mjs';
import { createAdminSession, hasAdminPassword, hasAdminSession, setAdminPassword, verifyAdminPassword } from './admin-auth.mjs';

const port = Number(process.env.LICENSE_PORT || 8787);
const dataDir = process.env.LICENSE_DATA_DIR || join(homedir(), '.notechange-license');
const { privateKey } = await ensureLicenseConfiguration(dataDir);
const databaseFile = join(dataDir, 'licenses.json');
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let database = await loadDatabase();
let sourceUpdate = { running: false, checkedAt: null, current: null, remote: null, logs: [] };

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true });
    if (request.method === 'GET' && url.pathname === '/admin') {
      if (!await hasAdminPassword(dataDir)) return html(response, setupPage);
      return html(response, hasAdminSession(request.headers.cookie) ? adminConsolePageWithUpdate : loginPage);
    }
    if (request.method === 'GET' && url.pathname === '/admin/deploy') return html(response, deploymentPageV2);
    if (request.method === 'GET' && (url.pathname === '/latest.yml' || url.pathname === '/latest-mac.yml')) return updateManifest(response, url.pathname);
    if (request.method === 'POST' && url.pathname === '/v1/licenses/activate') return activate(request, response);
    if (request.method === 'POST' && url.pathname === '/v1/licenses/deactivate') return deactivate(request, response);
    if (request.method === 'POST' && url.pathname === '/v1/admin/setup') return setupAdmin(request, response);
    if (request.method === 'POST' && url.pathname === '/v1/admin/login') return loginAdmin(request, response);
    if (request.method === 'POST' && url.pathname === '/v1/admin/logout') return logoutAdmin(response);
    if (url.pathname.startsWith('/v1/admin/')) return admin(request, response, url);
    return json(response, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    return json(response, 500, { error: error instanceof Error ? error.message : 'INTERNAL_ERROR' });
  }
}).listen(port, () => console.log(`License server listening on :${port}; open /admin to initialize or sign in`));

async function setupAdmin(request, response) {
  if (await hasAdminPassword(dataDir)) return json(response, 409, { error: 'ADMIN_ALREADY_CONFIGURED' });
  const { password } = await body(request);
  try { await setAdminPassword(dataDir, password); }
  catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : 'INVALID_PASSWORD' }); }
  createSession(response);
  return json(response, 201, { ok: true });
}

async function loginAdmin(request, response) {
  const { password } = await body(request);
  if (!await verifyAdminPassword(dataDir, password)) return json(response, 401, { error: 'ADMIN_PASSWORD_INVALID' });
  createSession(response);
  return json(response, 200, { ok: true });
}

function createSession(response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('set-cookie', `notechange_admin_session=${createAdminSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
}

function logoutAdmin(response) {
  response.setHeader('set-cookie', 'notechange_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return json(response, 200, { ok: true });
}

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
  if (!hasAdminSession(request.headers.cookie)) return json(response, 401, { error: 'ADMIN_UNAUTHORIZED' });
  if (request.method === 'GET' && url.pathname === '/v1/admin/source-update') return json(response, 200, sourceUpdate);
  if (request.method === 'POST' && url.pathname === '/v1/admin/source-update/check') return checkSourceUpdate(response);
  if (request.method === 'POST' && url.pathname === '/v1/admin/source-update/apply') return applySourceUpdate(response);
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

async function checkSourceUpdate(response) {
  if (sourceUpdate.running) return json(response, 409, { error: 'UPDATE_IN_PROGRESS' });
  try {
    sourceUpdate.running = true; sourceUpdate.logs = [];
    await runUpdateCommand('git', ['fetch', '--quiet', 'origin', 'main']);
    sourceUpdate.current = (await runUpdateCommand('git', ['rev-parse', 'HEAD'])).trim();
    sourceUpdate.remote = (await runUpdateCommand('git', ['rev-parse', 'origin/main'])).trim();
    sourceUpdate.checkedAt = new Date().toISOString();
    return json(response, 200, { ...sourceUpdate, available: sourceUpdate.current !== sourceUpdate.remote });
  } catch (error) {
    return json(response, 500, { error: 'UPDATE_CHECK_FAILED', detail: error instanceof Error ? error.message : 'UNKNOWN_ERROR', logs: sourceUpdate.logs });
  } finally { sourceUpdate.running = false; }
}

async function applySourceUpdate(response) {
  if (sourceUpdate.running) return json(response, 409, { error: 'UPDATE_IN_PROGRESS' });
  try {
    sourceUpdate.running = true; sourceUpdate.logs = [];
    await runUpdateCommand('git', ['fetch', '--quiet', 'origin', 'main']);
    const current = (await runUpdateCommand('git', ['rev-parse', 'HEAD'])).trim();
    const remote = (await runUpdateCommand('git', ['rev-parse', 'origin/main'])).trim();
    if (current !== remote) {
      await runUpdateCommand('git', ['pull', '--ff-only', 'origin', 'main']);
      await runUpdateCommand('npm', ['ci']);
    }
    sourceUpdate.current = (await runUpdateCommand('git', ['rev-parse', 'HEAD'])).trim();
    sourceUpdate.remote = (await runUpdateCommand('git', ['rev-parse', 'origin/main'])).trim();
    sourceUpdate.checkedAt = new Date().toISOString();
    const result = { ...sourceUpdate, updated: current !== remote, restartScheduled: current !== remote };
    json(response, 200, result);
    if (result.restartScheduled) {
      // BaoTa's Node project supervisor starts this process again after it exits.
      setTimeout(() => process.exit(0), 1500).unref();
    }
    return;
  } catch (error) {
    return json(response, 500, { error: 'UPDATE_APPLY_FAILED', detail: error instanceof Error ? error.message : 'UNKNOWN_ERROR', logs: sourceUpdate.logs });
  } finally { sourceUpdate.running = false; }
}

function runUpdateCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, shell: false });
    let output = '';
    const capture = (chunk) => { output += chunk.toString(); if (output.length > 12000) output = output.slice(-12000); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.on('error', reject);
    child.on('close', (code) => {
      sourceUpdate.logs.push(`$ ${command} ${args.join(' ')}\n${output || '(无输出)'}`);
      if (code === 0) resolve(output); else reject(new Error(`${command} 退出码 ${code}`));
    });
  });
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

const deploymentPage = `<!doctype html><meta charset="utf-8"><title>NoteChange 部署引导</title><style>body{font:15px system-ui;max-width:820px;margin:40px auto;padding:0 18px;color:#1e2a24}h1{font-size:24px}h2{margin-top:32px;font-size:18px}code,pre{font-family:ui-monospace,monospace}pre{padding:14px;border:1px solid #d7dfda;border-radius:6px;background:#f5f8f6;white-space:pre-wrap}li{margin:8px 0}.tip{padding:12px;border-left:3px solid #287154;background:#edf7f1}</style><p><a href="/admin">返回管理后台</a></p><h1>部署引导</h1><p>按顺序完成服务器、授权服务、HTTPS、桌面应用构建和版本发布。</p><h2>1. 初始化服务器</h2><pre>git clone &lt;仓库地址&gt; notechange; cd notechange; npm ci; npm run license:keys</pre><p>保存私钥和公钥。私钥只放在服务器，公钥用于构建桌面应用。</p><h2>2. 配置并启动授权服务</h2><pre>LICENSE_ADMIN_TOKEN='至少 32 位随机字符串'; LICENSE_PRIVATE_KEY_PEM='生成的私钥 PEM'; LICENSE_PORT=8787; LICENSE_DATA_DIR='/var/lib/notechange-license'; npm run license-server</pre><h2>3. 配置域名和 HTTPS</h2><p>用 Nginx 将 https://license.example.com 反向代理到 127.0.0.1:8787，并使用 Certbot 配置证书。不要直接暴露 8787 端口。</p><h2>4. 构建桌面应用</h2><pre>NOTECHANGE_LICENSE_SERVER_URL='https://license.example.com'; NOTECHANGE_UPDATE_URL='https://license.example.com'; NOTECHANGE_LICENSE_PUBLIC_KEY='生成的公钥 PEM'; npm run dist:mac; npm run dist:win</pre><h2>5. 发布更新</h2><ol><li>上传 macOS/Windows 安装包和 blockmap。</li><li>返回管理后台，填写版本、平台、文件相对路径和 SHA-512。</li><li>发布后客户端读取 latest.yml 或 latest-mac.yml。</li></ol><p class="tip">macOS 正式发布需要 Developer ID 签名和公证；Windows 建议使用代码签名证书。</p>`;

const deploymentPageV2 = `<!doctype html><meta charset="utf-8"><title>NoteChange 部署引导</title><style>body{font:15px system-ui;max-width:820px;margin:40px auto;padding:0 18px;color:#1e2a24}h1{font-size:24px}h2{margin-top:32px;font-size:18px}code,pre{font-family:ui-monospace,monospace}pre{padding:14px;border:1px solid #d7dfda;border-radius:6px;background:#f5f8f6;white-space:pre-wrap}li{margin:8px 0}.tip{padding:12px;border-left:3px solid #287154;background:#edf7f1}</style><p><a href="/admin">返回管理后台</a></p><h1>部署引导</h1><h2>1. 启动服务</h2><pre>npm ci\nnpm run admin:start</pre><p>首次启动后，直接打开 <code>https://你的域名/admin</code>，在网页内设置管理员密码。私钥、公钥、密码哈希和数据库会自动保存。</p><h2>2. 域名和 HTTPS</h2><p>将域名反向代理到 <code>127.0.0.1:8787</code>，并配置 SSL 证书。不要直接暴露 8787 端口。</p><h2>3. 构建桌面应用</h2><pre>NOTECHANGE_LICENSE_SERVER_URL='https://你的域名' NOTECHANGE_UPDATE_URL='https://你的域名' npm run release:mac\nNOTECHANGE_LICENSE_SERVER_URL='https://你的域名' NOTECHANGE_UPDATE_URL='https://你的域名' npm run release:win</pre><p>发布脚本自动读取服务器保存的公钥。</p><h2>4. 发布更新</h2><p>上传安装包与 blockmap 后，在管理后台填写版本、平台、文件路径与 SHA-512。</p></p>`;

const adminPage = `<!doctype html><meta charset="utf-8"><title>NoteChange 管理后台</title><style>body{font:14px system-ui;max-width:960px;margin:40px auto;padding:0 18px}input,button,textarea,select{font:inherit;padding:8px}table{width:100%;border-collapse:collapse;margin-top:20px}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}#created{white-space:pre-wrap;font-family:ui-monospace;color:#063}section{margin-top:36px;padding-top:18px;border-top:1px solid #ddd}</style><h1>NoteChange 管理后台</h1><p>永久激活码、设备绑定与版本发布。</p><div class="row"><input id="token" type="password" placeholder="管理员令牌"><button onclick="load()">刷新</button></div><section><h2>批量生成激活码</h2><div class="row"><input id="quantity" type="number" value="10" min="1" max="500"><input id="note" placeholder="批次备注"><button onclick="createCodes()">批量生成</button></div><pre id="created"></pre><table><thead><tr><th>创建时间</th><th>备注</th><th>状态</th><th>激活时间</th><th>操作</th></tr></thead><tbody id="rows"></tbody></table></section><section><h2>版本发布</h2><p>先将安装包与 blockmap 上传到更新服务器目录，再登记文件相对路径和 SHA-512。</p><div class="row"><input id="version" placeholder="版本，如 1.0.1"><select id="platform"><option value="win">Windows</option><option value="mac">macOS</option></select><input id="path" placeholder="NoteChange Setup 1.0.1.exe"><input id="sha512" placeholder="SHA-512"><input id="notes" placeholder="更新说明"><button onclick="publishRelease()">发布版本</button></div><table><thead><tr><th>平台</th><th>版本</th><th>文件</th><th>状态</th><th>操作</th></tr></thead><tbody id="releases"></tbody></table></section><script>const token=()=>document.querySelector('#token').value;const api=(path,opt={})=>fetch(path,{...opt,headers:{...opt.headers,authorization:'Bearer '+token(),'content-type':'application/json'}}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d});async function load(){try{const [d,r]=await Promise.all([api('/v1/admin/codes'),api('/v1/admin/releases')]);document.querySelector('#rows').innerHTML=d.codes.map(c=>'<tr><td>'+c.createdAt+'</td><td>'+c.note+'</td><td>'+ (c.revoked?'已禁用':c.installationId?'已激活':'未激活')+'</td><td>'+ (c.activatedAt||'')+'</td><td><button onclick="act(\\''+c.codeHash+'\\',\\'unbind\\')">解绑</button> <button onclick="act(\\''+c.codeHash+'\\',\\'revoke\\')">禁用</button></td></tr>').join('');document.querySelector('#releases').innerHTML=r.releases.map(x=>'<tr><td>'+x.platform+'</td><td>'+x.version+'</td><td>'+x.path+'</td><td>'+ (x.enabled?'已发布':'已停用')+'</td><td><button onclick="release(\\''+x.platform+'\\',\\''+(x.enabled?'disable':'enable')+'\\')">'+(x.enabled?'停用':'启用')+'</button></td></tr>').join('')}catch(e){alert(e.message)}}async function createCodes(){try{const d=await api('/v1/admin/codes',{method:'POST',body:JSON.stringify({quantity:+document.querySelector('#quantity').value,note:document.querySelector('#note').value})});document.querySelector('#created').textContent='请立即保存，激活码仅显示一次：\\n'+d.codes.map(c=>c.code).join('\\n');load()}catch(e){alert(e.message)}}async function act(hash,action){try{await api('/v1/admin/codes/'+hash+'/'+action,{method:'POST'});load()}catch(e){alert(e.message)}}async function publishRelease(){try{await api('/v1/admin/releases',{method:'POST',body:JSON.stringify({version:version.value,platform:platform.value,path:path.value,sha512:sha512.value,releaseNotes:notes.value})});load()}catch(e){alert(e.message)}}async function release(platform,action){try{await api('/v1/admin/releases/'+platform+'/'+action,{method:'POST'});load()}catch(e){alert(e.message)}}</script>`;

const pageStyle = `<style>body{font:14px system-ui;max-width:960px;margin:40px auto;padding:0 18px}input,button,textarea,select{font:inherit;padding:8px}button{cursor:pointer}table{width:100%;border-collapse:collapse;margin-top:20px}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}#created{white-space:pre-wrap;font-family:ui-monospace;color:#063}section{margin-top:36px;padding-top:18px;border-top:1px solid #ddd}.error{color:#b42318}</style>`;
const setupPage = `<!doctype html><meta charset="utf-8"><title>初始化 NoteChange 管理后台</title>${pageStyle}<h1>初始化管理后台</h1><p>请设置管理员密码。密码仅以加盐哈希形式保存在服务器，设置后将直接进入后台。</p><form id="form"><div class="row"><input id="password" type="password" autocomplete="new-password" placeholder="管理员密码" required><button>保存并进入后台</button></div><p id="error" class="error"></p></form><script>form.onsubmit=async e=>{e.preventDefault();error.textContent='';const r=await fetch('/v1/admin/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:password.value})});if(r.ok)return location.assign('/admin');error.textContent=(await r.json()).error||'保存失败'}</script>`;
const loginPage = `<!doctype html><meta charset="utf-8"><title>登录 NoteChange 管理后台</title>${pageStyle}<h1>NoteChange 管理后台</h1><form id="form"><div class="row"><input id="password" type="password" autocomplete="current-password" placeholder="管理员密码" required><button>登录</button></div><p id="error" class="error"></p></form><script>form.onsubmit=async e=>{e.preventDefault();error.textContent='';const r=await fetch('/v1/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:password.value})});if(r.ok)return location.assign('/admin');error.textContent='密码错误'}</script>`;
const adminConsolePage = `<!doctype html><meta charset="utf-8"><title>NoteChange 管理后台</title>${pageStyle}<h1>NoteChange 管理后台</h1><p>永久激活码、设备绑定与版本发布。 <a href="/admin/deploy">部署引导</a> <button onclick="logout()">退出登录</button></p><section><h2>批量生成激活码</h2><div class="row"><input id="quantity" type="number" value="10" min="1" max="500"><input id="note" placeholder="批次备注"><button onclick="createCodes()">批量生成</button></div><pre id="created"></pre><table><thead><tr><th>创建时间</th><th>备注</th><th>状态</th><th>激活时间</th><th>操作</th></tr></thead><tbody id="rows"></tbody></table></section><section><h2>版本发布</h2><p>先将安装包与 blockmap 上传到更新服务器目录，再登记文件相对路径和 SHA-512。</p><div class="row"><input id="version" placeholder="版本，如 1.0.1"><select id="platform"><option value="win">Windows</option><option value="mac">macOS</option></select><input id="path" placeholder="NoteChange Setup 1.0.1.exe"><input id="sha512" placeholder="SHA-512"><input id="notes" placeholder="更新说明"><button onclick="publishRelease()">发布版本</button></div><table><thead><tr><th>平台</th><th>版本</th><th>文件</th><th>状态</th><th>操作</th></tr></thead><tbody id="releases"></tbody></table></section><script>const api=(path,opt={})=>fetch(path,{...opt,headers:{...opt.headers,'content-type':'application/json'}}).then(async r=>{const d=await r.json();if(r.status===401)return location.assign('/admin');if(!r.ok)throw Error(d.error);return d});const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function load(){try{const[d,r]=await Promise.all([api('/v1/admin/codes'),api('/v1/admin/releases')]);rows.innerHTML=d.codes.map(c=>'<tr><td>'+escape(c.createdAt)+'</td><td>'+escape(c.note)+'</td><td>'+(c.revoked?'已禁用':c.installationId?'已激活':'未激活')+'</td><td>'+escape(c.activatedAt||'')+'</td><td><button onclick="act(\\''+c.codeHash+'\\',\\'unbind\\')">解绑</button> <button onclick="act(\\''+c.codeHash+'\\',\\'revoke\\')">禁用</button></td></tr>').join('');releases.innerHTML=r.releases.map(x=>'<tr><td>'+escape(x.platform)+'</td><td>'+escape(x.version)+'</td><td>'+escape(x.path)+'</td><td>'+(x.enabled?'已发布':'已停用')+'</td><td><button onclick="release(\\''+x.platform+'\\',\\''+(x.enabled?'disable':'enable')+'\\')">'+(x.enabled?'停用':'启用')+'</button></td></tr>').join('')}catch(e){alert(e.message)}}async function createCodes(){try{const d=await api('/v1/admin/codes',{method:'POST',body:JSON.stringify({quantity:+quantity.value,note:note.value})});created.textContent='请立即保存，激活码仅显示一次：\\n'+d.codes.map(c=>c.code).join('\\n');load()}catch(e){alert(e.message)}}async function act(hash,action){try{await api('/v1/admin/codes/'+hash+'/'+action,{method:'POST'});load()}catch(e){alert(e.message)}}async function publishRelease(){try{await api('/v1/admin/releases',{method:'POST',body:JSON.stringify({version:version.value,platform:platform.value,path:path.value,sha512:sha512.value,releaseNotes:notes.value})});load()}catch(e){alert(e.message)}}async function release(platformName,action){try{await api('/v1/admin/releases/'+platformName+'/'+action,{method:'POST'});load()}catch(e){alert(e.message)}}async function logout(){await api('/v1/admin/logout',{method:'POST'});location.assign('/admin')}load()</script>`;

const updateControls = `<section><h2>服务更新</h2><p>检查 GitHub 的 <code>main</code> 分支。立即更新会拉取代码、执行 <code>npm ci</code>，并由宝塔自动重启项目。</p><div class="row"><button id="check-update" onclick="checkServerUpdate()">检查更新</button><button id="apply-update" onclick="applyServerUpdate()" disabled>立即更新</button></div><p id="update-status"></p><pre id="update-log"></pre></section>`;
const updateScript = `async function checkServerUpdate(){const b=document.querySelector('#check-update');b.disabled=true;setUpdateStatus('正在检查更新...');try{const d=await api('/v1/admin/source-update/check',{method:'POST'});setUpdateResult(d,d.available?'发现新版本，可以立即更新。':'当前已是最新版本。');document.querySelector('#apply-update').disabled=!d.available}catch(e){setUpdateStatus(e.message)}finally{b.disabled=false}}async function applyServerUpdate(){const b=document.querySelector('#apply-update');b.disabled=true;setUpdateStatus('正在拉取代码和安装依赖，请勿关闭页面...');try{const d=await api('/v1/admin/source-update/apply',{method:'POST'});setUpdateResult(d,d.restartScheduled?'更新完成，服务将在几秒内自动重启。':'当前已是最新版本。')}catch(e){setUpdateStatus(e.message)}}function setUpdateStatus(v){document.querySelector('#update-status').textContent=v}function setUpdateResult(d,message){setUpdateStatus(message);document.querySelector('#update-log').textContent=(d.logs||[]).join('\\n\\n')}`;
const adminConsolePageWithUpdate = adminConsolePage.replace('<section><h2>批量生成激活码</h2>', `${updateControls}<section><h2>批量生成激活码</h2>`).replace('load()</script>', `${updateScript}load()</script>`);
