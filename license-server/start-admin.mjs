import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const dataDir = process.env.LICENSE_DATA_DIR || join(homedir(), '.notechange-license');
const child = spawn(process.execPath, ['license-server/server.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, LICENSE_DATA_DIR: dataDir }
});
child.on('exit', (code) => process.exit(code ?? 1));
