import { homedir } from 'node:os';
import { join } from 'node:path';
import { readPublicKey } from './key-store.mjs';

const dataDir = process.env.LICENSE_DATA_DIR || join(homedir(), '.notechange-license');
process.stdout.write(await readPublicKey(dataDir));
