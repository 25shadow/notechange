import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { shouldRestartAfterExit } from './restart-policy.mjs';

const dataDir = process.env.LICENSE_DATA_DIR || join(homedir(), '.notechange-license');

function startServer() {
  const child = spawn(process.execPath, ['license-server/server.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, LICENSE_DATA_DIR: dataDir }
  });
  child.on('exit', (code) => {
    if (shouldRestartAfterExit(code)) {
      console.log('更新完成，正在重启授权服务...');
      setTimeout(startServer, 250);
      return;
    }
    process.exit(code ?? 1);
  });
}

startServer();
