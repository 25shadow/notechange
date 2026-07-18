import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator';

import { FingerprintStore } from '../../src/main/browser/fingerprint-store';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('FingerprintStore', () => {
  it('creates a fingerprint once and reloads it from the provider profile', async () => {
    const directory = await createDirectory();
    const fingerprint = fixtureFingerprint();
    const generator = { getFingerprint: vi.fn(() => fingerprint) };
    const store = new FingerprintStore(generator);

    await expect(store.loadOrCreate(directory)).resolves.toEqual(fingerprint);
    await expect(store.loadOrCreate(directory)).resolves.toEqual(fingerprint);

    expect(generator.getFingerprint).toHaveBeenCalledOnce();
  });

  it('regenerates and replaces a malformed fingerprint snapshot', async () => {
    const directory = await createDirectory();
    const fingerprint = fixtureFingerprint();
    const generator = { getFingerprint: vi.fn(() => fingerprint) };
    const store = new FingerprintStore(generator);
    const snapshot = join(directory, 'notechange-fingerprint.json');
    await writeFile(snapshot, '{ not json', 'utf8');

    await expect(store.loadOrCreate(directory)).resolves.toEqual(fingerprint);
    await expect(readFile(snapshot, 'utf8')).resolves.toBe(
      JSON.stringify({ version: 1, fingerprint })
    );
    expect(generator.getFingerprint).toHaveBeenCalledOnce();
  });

  it('regenerates a structurally incomplete fingerprint snapshot', async () => {
    const directory = await createDirectory();
    const fingerprint = fixtureFingerprint();
    const generator = { getFingerprint: vi.fn(() => fingerprint) };
    const store = new FingerprintStore(generator);
    const snapshot = join(directory, 'notechange-fingerprint.json');
    await writeFile(
      snapshot,
      JSON.stringify({ version: 1, fingerprint: { headers: {}, fingerprint: {} } }),
      'utf8'
    );

    await expect(store.loadOrCreate(directory)).resolves.toEqual(fingerprint);
    expect(generator.getFingerprint).toHaveBeenCalledOnce();
  });

  it('regenerates a snapshot missing navigator user agent data', async () => {
    const directory = await createDirectory();
    const fingerprint = fixtureFingerprint();
    const generator = { getFingerprint: vi.fn(() => fingerprint) };
    const store = new FingerprintStore(generator);
    const { userAgentData: _userAgentData, ...navigator } = fingerprint.fingerprint.navigator;
    await writeFile(
      join(directory, 'notechange-fingerprint.json'),
      JSON.stringify({
        version: 1,
        fingerprint: {
          ...fingerprint,
          fingerprint: { ...fingerprint.fingerprint, navigator }
        }
      }),
      'utf8'
    );

    await expect(store.loadOrCreate(directory)).resolves.toEqual(fingerprint);
    expect(generator.getFingerprint).toHaveBeenCalledOnce();
  });

  it('shares a fingerprint generation operation for concurrent callers', async () => {
    const directory = await createDirectory();
    const fingerprint = fixtureFingerprint();
    const generator = { getFingerprint: vi.fn(() => fingerprint) };
    const store = new FingerprintStore(generator);

    await expect(
      Promise.all([store.loadOrCreate(directory), store.loadOrCreate(directory)])
    ).resolves.toEqual([fingerprint, fingerprint]);
    expect(generator.getFingerprint).toHaveBeenCalledOnce();
  });

  it('removes only the fingerprint snapshot', async () => {
    const directory = await createDirectory();
    const fingerprint = fixtureFingerprint();
    const store = new FingerprintStore({ getFingerprint: vi.fn(() => fingerprint) });
    const unrelatedFile = join(directory, 'unrelated.txt');
    await writeFile(unrelatedFile, 'keep me', 'utf8');
    await store.loadOrCreate(directory);

    await store.remove(directory);

    await expect(readFile(unrelatedFile, 'utf8')).resolves.toBe('keep me');
    await expect(readFile(join(directory, 'notechange-fingerprint.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });
});

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'notechange-fingerprint-test-'));
  directories.push(directory);
  return directory;
}

function fixtureFingerprint(): BrowserFingerprintWithHeaders {
  return {
    fingerprint: {
      navigator: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        userAgentData: {
          brands: [{ brand: 'Chromium', version: '120' }],
          mobile: false,
          platform: 'macOS',
          architecture: 'x86',
          bitness: '64',
          fullVersionList: [{ brand: 'Chromium', version: '120.0.0.0' }],
          model: '',
          platformVersion: '14.0.0',
          uaFullVersion: '120.0.0.0'
        },
        doNotTrack: '1',
        appCodeName: 'Mozilla',
        appName: 'Netscape',
        appVersion: '5.0',
        oscpu: 'Intel Mac OS X 10_15_7',
        webdriver: 'false',
        language: 'en-US',
        languages: ['en-US', 'en'],
        platform: 'MacIntel',
        hardwareConcurrency: 8,
        product: 'Gecko',
        productSub: '20030107',
        vendor: 'Google Inc.',
        vendorSub: '',
        extraProperties: {
          vendorFlavors: [],
          isBluetoothSupported: false,
          globalPrivacyControl: null,
          pdfViewerEnabled: true,
          installedApps: []
        }
      },
      screen: {
        availHeight: 875,
        availWidth: 1440,
        availTop: 0,
        availLeft: 0,
        colorDepth: 24,
        height: 900,
        pixelDepth: 24,
        width: 1440,
        devicePixelRatio: 1,
        pageXOffset: 0,
        pageYOffset: 0,
        innerHeight: 800,
        outerHeight: 900,
        outerWidth: 1440,
        innerWidth: 1440,
        screenX: 0,
        clientWidth: 1440,
        clientHeight: 800,
        hasHDR: false
      },
      videoCodecs: {},
      audioCodecs: {},
      pluginsData: {},
      videoCard: {
        renderer: 'Apple M1',
        vendor: 'Apple Inc.'
      },
      multimediaDevices: [],
      fonts: [],
      mockWebRTC: false
    },
    headers: {
      acceptLanguage: 'en-US,en;q=0.9'
    }
  } satisfies BrowserFingerprintWithHeaders;
}
