import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';

const maxArtifactSize = 4 * 1024 * 1024 * 1024;

export function validateArtifactName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,180}$/.test(value)) return null;
  return value;
}

export function artifactDirectory(dataDir) {
  return join(dataDir, 'releases');
}

export async function storeArtifact(dataDir, input, originalName) {
  const name = validateArtifactName(originalName);
  if (!name) throw new Error('INVALID_ARTIFACT_NAME');
  const directory = artifactDirectory(dataDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${randomBytes(12).toString('hex')}.upload`);
  const destination = join(directory, name);
  const stream = createWriteStream(temporary, { mode: 0o600 });
  const hash = createHash('sha512');
  let size = 0;
  try {
    for await (const chunk of input) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxArtifactSize) throw new Error('ARTIFACT_TOO_LARGE');
      hash.update(buffer);
      if (!stream.write(buffer)) await new Promise((resolve, reject) => { stream.once('drain', resolve); stream.once('error', reject); });
    }
    await new Promise((resolve, reject) => { stream.once('finish', resolve); stream.once('error', reject); stream.end(); });
    await rename(temporary, destination);
  } catch (error) {
    stream.destroy();
    throw error;
  }
  return { name, path: `releases/${name}`, sha512: hash.digest('base64'), size };
}

export async function readArtifact(dataDir, name) {
  const safeName = validateArtifactName(name);
  if (!safeName) return null;
  const file = join(artifactDirectory(dataDir), safeName);
  try { return { file, stat: await stat(file) }; } catch { return null; }
}
