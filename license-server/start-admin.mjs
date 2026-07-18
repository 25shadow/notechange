import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { spawn } from 'node:child_process';

const dataDir = process.env.LICENSE_DATA_DIR || join(homedir(), '.notechange-license');
const tokenFile = join(dataDir, 'admin-token');
let adminToken = process.env.LICENSE_ADMIN_TOKEN || '';
try { await access(tokenFile); } catch {
  if (!adminToken) {
    const input = createInterface({ input: stdin, output: stdout });
    adminToken = await input.question('首次启动，请设置管理员密码（至少 12 位）：');
    input.close();
    if (adminToken.length < 12) throw new Error('管理员密码至少需要 12 位。');
  }
}
const child = spawn(process.execPath, ['license-server/server.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, LICENSE_DATA_DIR: dataDir, ...(adminToken ? { LICENSE_ADMIN_TOKEN: adminToken } : {}) }
});
child.on('exit', (code) => process.exit(code ?? 1));
try {
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (token) console.log(`管理后台：http://127.0.0.1:${process.env.LICENSE_PORT || 8787}/admin`);
} catch { /* server creates the file after startup */ }
