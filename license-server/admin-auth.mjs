import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const scrypt = promisify(scryptCallback);
const credentialFileName = 'admin-password.json';
const sessions = new Map();

export async function hasAdminPassword(dataDir) {
  try {
    const credential = JSON.parse(await readFile(join(dataDir, credentialFileName), 'utf8'));
    return typeof credential.salt === 'string' && typeof credential.hash === 'string';
  } catch {
    return false;
  }
}

export async function setAdminPassword(dataDir, password) {
  if (typeof password !== 'string' || !password) throw new Error('ADMIN_PASSWORD_REQUIRED');
  const salt = randomBytes(16).toString('base64url');
  const hash = (await scrypt(password, salt, 32)).toString('base64url');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await atomicWrite(join(dataDir, credentialFileName), JSON.stringify({ salt, hash }), 0o600);
}

export async function verifyAdminPassword(dataDir, password) {
  if (typeof password !== 'string') return false;
  try {
    const credential = JSON.parse(await readFile(join(dataDir, credentialFileName), 'utf8'));
    const expected = Buffer.from(credential.hash, 'base64url');
    const actual = await scrypt(password, credential.salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createAdminSession() {
  const id = randomBytes(32).toString('base64url');
  sessions.set(id, Date.now() + 12 * 60 * 60 * 1000);
  return id;
}

export function hasAdminSession(cookieHeader = '') {
  const session = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith('notechange_admin_session='))?.slice('notechange_admin_session='.length);
  const expiresAt = session && sessions.get(session);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) { sessions.delete(session); return false; }
  return true;
}

function atomicWrite(file, value, mode) {
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  return writeFile(temporary, value, { mode }).then(() => rename(temporary, file));
}
