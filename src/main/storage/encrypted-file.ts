import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { SecretProtector } from './protector';

const magic = Buffer.from('NOTECHANGE1');
const ivLength = 12;
const tagLength = 16;

export class EncryptedFile {
  constructor(
    private readonly keyPath: string,
    private readonly protector: SecretProtector
  ) {}

  async encrypt(plaintext: Buffer): Promise<Buffer> {
    const key = await this.getDataKey();
    const iv = randomBytes(ivLength);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(magic);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    return Buffer.concat([magic, iv, cipher.getAuthTag(), ciphertext]);
  }

  async decrypt(file: Buffer): Promise<Buffer> {
    const minimumLength = magic.length + ivLength + tagLength;
    if (file.length < minimumLength || !file.subarray(0, magic.length).equals(magic)) {
      throw new Error('INVALID_ENCRYPTED_FILE');
    }

    const key = await this.getDataKey();
    const ivStart = magic.length;
    const tagStart = ivStart + ivLength;
    const ciphertextStart = tagStart + tagLength;
    const decipher = createDecipheriv('aes-256-gcm', key, file.subarray(ivStart, tagStart));
    decipher.setAAD(magic);
    decipher.setAuthTag(file.subarray(tagStart, ciphertextStart));

    return Buffer.concat([
      decipher.update(file.subarray(ciphertextStart)),
      decipher.final()
    ]);
  }

  private async getDataKey(): Promise<Buffer> {
    try {
      return this.protector.unprotect(await readFile(this.keyPath));
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
    }

    const key = randomBytes(32);
    await mkdir(dirname(this.keyPath), { recursive: true });
    await writeFile(this.keyPath, this.protector.protect(key), { mode: 0o600, flag: 'wx' });
    return key;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
