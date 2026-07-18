import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  FingerprintGenerator,
  type BrowserFingerprintWithHeaders
} from 'fingerprint-generator';
import { z } from 'zod';

export interface FingerprintGeneratorClient {
  getFingerprint(): BrowserFingerprintWithHeaders;
}

type StoredFingerprint = {
  version: 1;
  fingerprint: BrowserFingerprintWithHeaders;
};

const fingerprintFileName = 'notechange-fingerprint.json';

export class FingerprintStore {
  private readonly pendingLoads = new Map<string, Promise<BrowserFingerprintWithHeaders>>();

  constructor(
    private readonly generator: FingerprintGeneratorClient = new FingerprintGenerator({
      browsers: [{ name: 'chrome', minVersion: 120 }],
      devices: ['desktop']
    })
  ) {}

  async loadOrCreate(directory: string): Promise<BrowserFingerprintWithHeaders> {
    const pending = this.pendingLoads.get(directory);
    if (pending) return pending;

    const loading = this.loadOrCreateNew(directory);
    this.pendingLoads.set(directory, loading);
    try {
      return await loading;
    } finally {
      if (this.pendingLoads.get(directory) === loading) this.pendingLoads.delete(directory);
    }
  }

  async remove(directory: string): Promise<void> {
    await rm(join(directory, fingerprintFileName), { force: true });
  }

  private async loadOrCreateNew(directory: string): Promise<BrowserFingerprintWithHeaders> {
    const stored = await this.load(directory);
    if (stored) return stored;

    const fingerprint = this.generator.getFingerprint();
    await this.save(directory, fingerprint);
    return fingerprint;
  }

  private async load(directory: string): Promise<BrowserFingerprintWithHeaders | null> {
    try {
      const stored = JSON.parse(
        await readFile(join(directory, fingerprintFileName), 'utf8')
      ) as unknown;
      const parsed = storedFingerprintSchema.safeParse(stored);
      return parsed.success ? parsed.data.fingerprint : null;
    } catch {
      return null;
    }
  }

  private async save(
    directory: string,
    fingerprint: BrowserFingerprintWithHeaders
  ): Promise<void> {
    await mkdir(directory, { recursive: true });
    const fingerprintFile = join(directory, fingerprintFileName);
    const temporaryFile = `${fingerprintFile}.${process.pid}.tmp`;
    const stored: StoredFingerprint = { version: 1, fingerprint };
    await writeFile(temporaryFile, JSON.stringify(stored), {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporaryFile, fingerprintFile);
  }
}

const brandSchema = z.object({
  brand: z.string(),
  version: z.string()
});

const storedFingerprintSchema: z.ZodType<StoredFingerprint> = z.object({
  version: z.literal(1),
  fingerprint: z.object({
    headers: z.record(z.string(), z.string()).refine((headers) => Object.keys(headers).length > 0),
    fingerprint: z.object({
      screen: z.object({
        availHeight: z.number(),
        availWidth: z.number(),
        availTop: z.number(),
        availLeft: z.number(),
        colorDepth: z.number(),
        height: z.number(),
        pixelDepth: z.number(),
        width: z.number(),
        devicePixelRatio: z.number(),
        pageXOffset: z.number(),
        pageYOffset: z.number(),
        innerHeight: z.number(),
        outerHeight: z.number(),
        outerWidth: z.number(),
        innerWidth: z.number(),
        screenX: z.number(),
        clientWidth: z.number(),
        clientHeight: z.number(),
        hasHDR: z.boolean()
      }),
      navigator: z.object({
        userAgent: z.string(),
        userAgentData: z.object({
          brands: z.array(brandSchema),
          mobile: z.boolean(),
          platform: z.string(),
          architecture: z.string(),
          bitness: z.string(),
          fullVersionList: z.array(brandSchema),
          model: z.string(),
          platformVersion: z.string(),
          uaFullVersion: z.string()
        }),
        doNotTrack: z.string(),
        appCodeName: z.string(),
        appName: z.string(),
        appVersion: z.string(),
        oscpu: z.string(),
        webdriver: z.string(),
        language: z.string(),
        languages: z.array(z.string()),
        platform: z.string(),
        deviceMemory: z.number().optional(),
        hardwareConcurrency: z.number(),
        product: z.string(),
        productSub: z.string(),
        vendor: z.string(),
        vendorSub: z.string(),
        maxTouchPoints: z.number().optional(),
        extraProperties: z.object({
          vendorFlavors: z.array(z.string()),
          isBluetoothSupported: z.boolean(),
          globalPrivacyControl: z.null(),
          pdfViewerEnabled: z.boolean(),
          installedApps: z.array(z.unknown())
        })
      }),
      videoCodecs: z.record(z.string(), z.string()),
      audioCodecs: z.record(z.string(), z.string()),
      pluginsData: z.record(z.string(), z.string()),
      battery: z.record(z.string(), z.string()).optional(),
      videoCard: z.object({
        renderer: z.string(),
        vendor: z.string()
      }),
      multimediaDevices: z.array(z.string()),
      fonts: z.array(z.string()),
      mockWebRTC: z.boolean(),
      slim: z.boolean().optional()
    })
  })
});
