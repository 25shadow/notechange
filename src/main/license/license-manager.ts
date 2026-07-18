import { randomUUID, verify } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LicenseStatus } from '../../shared/ipc';

declare const __NOTECHANGE_LICENSE_SERVER_URL__: string;
declare const __NOTECHANGE_LICENSE_PUBLIC_KEY__: string;

type LicensePayload = { licenseId: string; installationId: string; issuedAt: string };
type StoredLicense = { license: LicensePayload; signature: string };

export class LicenseManager {
  private readonly licenseFile: string;
  private readonly installationFile: string;

  constructor(
    rootDirectory: string,
    private readonly serverUrl = __NOTECHANGE_LICENSE_SERVER_URL__ || process.env.NOTECHANGE_LICENSE_SERVER_URL || '',
    private readonly publicKey = normalizePem(__NOTECHANGE_LICENSE_PUBLIC_KEY__ || process.env.NOTECHANGE_LICENSE_PUBLIC_KEY || '')
  ) {
    this.licenseFile = join(rootDirectory, 'license.json');
    this.installationFile = join(rootDirectory, 'installation-id');
  }

  async getStatus(): Promise<LicenseStatus> {
    if (!this.isConfigured()) return { state: 'unconfigured', licenseId: null, message: '授权服务尚未配置' };
    const stored = await this.readLicense();
    await this.installationId();
    if (!stored || !this.isValid(stored)) return { state: 'inactive', licenseId: null, message: '请输入永久激活码' };
    return { state: 'active', licenseId: stored.license.licenseId, message: '永久授权已激活' };
  }

  async activate(code: string): Promise<LicenseStatus> {
    if (!this.isConfigured()) throw new Error('LICENSE_SERVICE_UNCONFIGURED');
    const normalizedCode = code.trim().toUpperCase();
    if (!/^NC-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3,5}$/.test(normalizedCode)) {
      throw new Error('LICENSE_CODE_INVALID');
    }
    const response = await fetch(`${this.serverUrl}/v1/licenses/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: normalizedCode, installationId: await this.installationId() })
    });
    if (!response.ok) throw new Error(await responseError(response));
    const stored = await response.json() as StoredLicense;
    if (!this.isValid(stored)) throw new Error('LICENSE_SIGNATURE_INVALID');
    await this.saveLicense(stored);
    return { state: 'active', licenseId: stored.license.licenseId, message: '永久授权已激活' };
  }

  async deactivate(): Promise<LicenseStatus> {
    const stored = await this.readLicense();
    if (stored && this.isConfigured()) {
      await fetch(`${this.serverUrl}/v1/licenses/deactivate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ licenseId: stored.license.licenseId, installationId: await this.installationId() })
      }).catch(() => undefined);
    }
    await rm(this.licenseFile, { force: true });
    return this.getStatus();
  }

  private isConfigured(): boolean { return Boolean(this.serverUrl && this.publicKey); }
  private isValid(stored: StoredLicense): boolean {
    return Boolean(stored?.license?.licenseId && stored.license.installationId) &&
      stored.license.installationId === this.cachedInstallationId &&
      verify(null, Buffer.from(JSON.stringify(stored.license)), this.publicKey, Buffer.from(stored.signature, 'base64'));
  }
  private cachedInstallationId = '';
  private async installationId(): Promise<string> {
    if (this.cachedInstallationId) return this.cachedInstallationId;
    try { this.cachedInstallationId = (await readFile(this.installationFile, 'utf8')).trim(); } catch { /* generated below */ }
    if (!this.cachedInstallationId) {
      this.cachedInstallationId = randomUUID();
      await mkdir(join(this.installationFile, '..'), { recursive: true, mode: 0o700 });
      await writeFile(this.installationFile, this.cachedInstallationId, { mode: 0o600 });
    }
    return this.cachedInstallationId;
  }
  private async readLicense(): Promise<StoredLicense | null> {
    try { return JSON.parse(await readFile(this.licenseFile, 'utf8')) as StoredLicense; } catch { return null; }
  }
  private async saveLicense(stored: StoredLicense): Promise<void> {
    await mkdir(join(this.licenseFile, '..'), { recursive: true, mode: 0o700 });
    const temporary = `${this.licenseFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(stored), { mode: 0o600 });
    await rename(temporary, this.licenseFile);
  }
}

function normalizePem(value: string): string { return value.replace(/\\n/g, '\n').trim(); }
async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `LICENSE_HTTP_${response.status}`;
}
