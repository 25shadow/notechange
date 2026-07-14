import { safeStorage } from 'electron';

export interface SecretProtector {
  protect(value: Buffer): Buffer;
  unprotect(value: Buffer): Buffer;
}

export class ElectronSecretProtector implements SecretProtector {
  protect(value: Buffer): Buffer {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('SAFE_STORAGE_UNAVAILABLE');
    }

    return safeStorage.encryptString(value.toString('base64'));
  }

  unprotect(value: Buffer): Buffer {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('SAFE_STORAGE_UNAVAILABLE');
    }

    return Buffer.from(safeStorage.decryptString(value), 'base64');
  }
}
