import { join } from 'node:path';
import { homedir } from 'node:os';
import { ensureLicenseConfiguration } from './key-store.mjs';

const dataDir = process.env.LICENSE_DATA_DIR || join(homedir(), '.notechange-license');
const { publicKey } = await ensureLicenseConfiguration(dataDir);
console.log(`授权服务已初始化：${dataDir}`);
console.log(`管理员令牌：${join(dataDir, 'admin-token')}`);
console.log(`公钥已自动用于 npm run release:mac 和 npm run release:win`);
console.log(`公钥指纹长度：${publicKey.length}`);
