import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveBuildPublicKey } from './build-config.mjs';

const platform = process.argv[2];
if (!['mac', 'win'].includes(platform)) throw new Error('Use: node license-server/release.mjs mac|win');
if (!process.env.NOTECHANGE_LICENSE_SERVER_URL || !process.env.NOTECHANGE_UPDATE_URL) {
  throw new Error('Set NOTECHANGE_LICENSE_SERVER_URL and NOTECHANGE_UPDATE_URL.');
}
const dataDir = process.env.LICENSE_DATA_DIR || join(homedir(), '.notechange-license');
const publicKey = await resolveBuildPublicKey(process.env, dataDir);
const environment = { ...process.env, NOTECHANGE_LICENSE_PUBLIC_KEY: publicKey };
const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', env: environment });
if (build.status !== 0) process.exit(build.status ?? 1);
const dist = spawnSync('npx', ['electron-builder', `--${platform}`, '--publish', 'never'], { stdio: 'inherit', env: environment });
process.exit(dist.status ?? 1);
