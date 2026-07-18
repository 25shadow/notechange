import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const keyFileName = 'signing-keys.json';

export async function ensureLicenseConfiguration(dataDir) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const keys = await loadOrCreateKeys(dataDir);
  return keys;
}

export async function readPublicKey(dataDir) {
  const keys = await loadOrCreateKeys(dataDir);
  return keys.publicKey;
}

async function loadOrCreateKeys(dataDir) {
  const file = join(dataDir, keyFileName);
  try {
    const stored = JSON.parse(await readFile(file, 'utf8'));
    if (typeof stored.privateKey === 'string' && typeof stored.publicKey === 'string') return stored;
  } catch { /* generated below */ }
  if (process.env.LICENSE_PRIVATE_KEY_PEM) {
    throw new Error('Automatic key storage requires both generated keys; remove LICENSE_PRIVATE_KEY_PEM or use the generated key file.');
  }
  const pair = generateKeyPairSync('ed25519');
  const keys = {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' })
  };
  await atomicWrite(file, JSON.stringify(keys), 0o600);
  return keys;
}

async function atomicWrite(file, value, mode) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, value, { mode });
  await rename(temporary, file);
}
