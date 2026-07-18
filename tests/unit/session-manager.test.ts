import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright';
import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator';

import { SessionManager } from '../../src/main/browser/session-manager';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SessionManager headless transition', () => {
  it('defers default fingerprint creation until a browser session is opened', () => {
    expect(() => new SessionManager({ headless: false })).not.toThrow();
  });

  it('applies the stored fingerprint before restoring cookies and navigating', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const page = fakePage();
    const context = fakeContext(page);
    const fingerprint = fixtureFingerprint();
    const attachFingerprintToPlaywright = vi.fn(async () => undefined);
    const fingerprints = {
      loadOrCreate: vi.fn(async () => fingerprint),
      remove: vi.fn(async () => undefined)
    };
    const launcher = { launchPersistentContext: vi.fn(async () => context) };
    const manager = new SessionManager(
      { headless: false },
      root,
      launcher,
      fingerprints,
      { attachFingerprintToPlaywright }
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');

    expect(attachFingerprintToPlaywright).toHaveBeenCalledWith(context, fingerprint);
    expect(fingerprints.loadOrCreate.mock.invocationCallOrder[0]).toBeLessThan(
      launcher.launchPersistentContext.mock.invocationCallOrder[0]
    );
    expect(launcher.launchPersistentContext.mock.invocationCallOrder[0]).toBeLessThan(
      attachFingerprintToPlaywright.mock.invocationCallOrder[0]
    );
    expect(attachFingerprintToPlaywright.mock.invocationCallOrder[0]).toBeLessThan(
      context.addCookies.mock.invocationCallOrder[0]
    );
    expect(context.addCookies.mock.invocationCallOrder[0]).toBeLessThan(
      page.goto.mock.invocationCallOrder[0]
    );
    await manager.disposeAll();
  });

  it('uses the fingerprint user agent and screen size when launching a context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const context = fakeContext(fakePage());
    const fingerprint = fixtureFingerprint();
    const launcher = { launchPersistentContext: vi.fn(async () => context) };
    const manager = new SessionManager(
      { headless: false },
      root,
      launcher,
      fakeFingerprintStore(fingerprint),
      fakeFingerprintInjector()
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');

    expect(launcher.launchPersistentContext).toHaveBeenCalledWith(join(root, 'xiaomi'), {
      headless: false,
      userAgent: fingerprint.fingerprint.navigator.userAgent,
      viewport: {
        width: fingerprint.fingerprint.screen.width,
        height: fingerprint.fingerprint.screen.height
      }
    });
    await manager.disposeAll();
  });

  it('关闭可见上下文后使用同一 profile 重启为 headless', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const sessionCookies = [
      {
        name: 'session',
        value: 'local-test-secret',
        domain: '.mi.com',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const
      }
    ];
    const visiblePage = fakePage();
    const headlessPage = fakePage();
    const visibleContext = fakeContext(visiblePage, sessionCookies);
    const headlessContext = fakeContext(headlessPage);
    const launcher = {
      launchPersistentContext: vi
        .fn()
        .mockResolvedValueOnce(visibleContext)
        .mockResolvedValueOnce(headlessContext)
    };
    const manager = new SessionManager(
      { headless: false },
      root,
      launcher,
      fakeFingerprintStore(),
      fakeFingerprintInjector()
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');
    await manager.switchToHeadless('xiaomi', 'https://i.mi.com/note/h5#/');

    expect(visibleContext.close).toHaveBeenCalledOnce();
    expect(launcher.launchPersistentContext).toHaveBeenCalledTimes(2);
    const [visibleDirectory, visibleOptions] = launcher.launchPersistentContext.mock.calls[0];
    const [headlessDirectory, headlessOptions] = launcher.launchPersistentContext.mock.calls[1];
    expect(headlessDirectory).toBe(visibleDirectory);
    expect(visibleOptions).toMatchObject({ headless: false });
    expect(headlessOptions).toMatchObject({ headless: true });
    expect(visibleContext.cookies).toHaveBeenCalledOnce();
    expect(headlessContext.addCookies).toHaveBeenCalledWith(sessionCookies);
    expect(visibleContext.cookies.mock.invocationCallOrder[0]).toBeLessThan(
      visibleContext.close.mock.invocationCallOrder[0]
    );
    expect(headlessContext.addCookies.mock.invocationCallOrder[0]).toBeLessThan(
      headlessPage.goto.mock.invocationCallOrder[0]
    );

    await manager.disposeAll();
  });

  it('跨上下文复用同一个厂商 profile 且退出时不删除', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const launcher = {
      launchPersistentContext: vi
        .fn()
        .mockResolvedValueOnce(fakeContext(fakePage()))
        .mockResolvedValueOnce(fakeContext(fakePage()))
    };
    const manager = new SessionManager(
      { headless: false },
      root,
      launcher,
      fakeFingerprintStore(),
      fakeFingerprintInjector()
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');
    await manager.disposeAll();
    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');

    expect(launcher.launchPersistentContext.mock.calls[0][0]).toBe(join(root, 'xiaomi'));
    expect(launcher.launchPersistentContext.mock.calls[1][0]).toBe(join(root, 'xiaomi'));
    await manager.disposeAll();
    await expect(stat(join(root, 'xiaomi'))).resolves.toBeDefined();
  });

  it('为小米和 vivo 使用相互隔离的 profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const launcher = {
      launchPersistentContext: vi
        .fn()
        .mockResolvedValueOnce(fakeContext(fakePage()))
        .mockResolvedValueOnce(fakeContext(fakePage()))
    };
    const manager = new SessionManager(
      { headless: false },
      root,
      launcher,
      fakeFingerprintStore(),
      fakeFingerprintInjector()
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');
    await manager.open('vivo', 'https://pc.vivo.com.cn/suite#/note');

    expect(launcher.launchPersistentContext.mock.calls[0][0]).toBe(join(root, 'xiaomi'));
    expect(launcher.launchPersistentContext.mock.calls[1][0]).toBe(join(root, 'vivo'));
    await manager.disposeAll();
  });

  it('loads isolated fingerprint snapshots for Xiaomi and vivo profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const fingerprints = fakeFingerprintStore();
    const manager = new SessionManager(
      { headless: false },
      root,
      {
        launchPersistentContext: vi
          .fn()
          .mockResolvedValueOnce(fakeContext(fakePage()))
          .mockResolvedValueOnce(fakeContext(fakePage()))
      },
      fingerprints,
      fakeFingerprintInjector()
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');
    await manager.open('vivo', 'https://pc.vivo.com.cn/suite#/note');

    expect(fingerprints.loadOrCreate).toHaveBeenNthCalledWith(1, join(root, 'xiaomi'));
    expect(fingerprints.loadOrCreate).toHaveBeenNthCalledWith(2, join(root, 'vivo'));
    await manager.disposeAll();
  });

  it('使用同一个 profile 从 headless 切换到 headed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const launcher = {
      launchPersistentContext: vi
        .fn()
        .mockResolvedValueOnce(fakeContext(fakePage()))
        .mockResolvedValueOnce(fakeContext(fakePage()))
    };
    const manager = new SessionManager(
      { headless: false },
      root,
      launcher,
      fakeFingerprintStore(),
      fakeFingerprintInjector()
    );

    await manager.open('vivo', 'https://pc.vivo.com.cn/suite#/note', 'headless');
    await manager.switchToHeaded('vivo', 'https://pc.vivo.com.cn/suite#/note');

    expect(launcher.launchPersistentContext.mock.calls[0][1]).toMatchObject({ headless: true });
    expect(launcher.launchPersistentContext.mock.calls[1][1]).toMatchObject({ headless: false });
    expect(launcher.launchPersistentContext.mock.calls[1][0]).toBe(
      launcher.launchPersistentContext.mock.calls[0][0]
    );
    await manager.disposeAll();
  });

  it('reloads and reapplies the provider fingerprint during a mode transition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const fingerprint = fixtureFingerprint();
    const fingerprints = fakeFingerprintStore(fingerprint);
    const attachFingerprintToPlaywright = vi.fn(async () => undefined);
    const manager = new SessionManager(
      { headless: false },
      root,
      {
        launchPersistentContext: vi
          .fn()
          .mockResolvedValueOnce(fakeContext(fakePage()))
          .mockResolvedValueOnce(fakeContext(fakePage()))
      },
      fingerprints,
      { attachFingerprintToPlaywright }
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');
    await manager.switchToHeadless('xiaomi', 'https://i.mi.com/note/h5#/');

    expect(fingerprints.loadOrCreate).toHaveBeenCalledTimes(2);
    expect(fingerprints.loadOrCreate).toHaveBeenLastCalledWith(join(root, 'xiaomi'));
    expect(attachFingerprintToPlaywright).toHaveBeenCalledTimes(2);
    await manager.disposeAll();
  });

  it('并发打开同一个厂商时只启动一个 Chromium 上下文', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const sharedPage = fakePage();
    const launcher = {
      launchPersistentContext: vi.fn(async () => fakeContext(sharedPage))
    };
    const manager = new SessionManager(
      { headless: false },
      root,
      launcher,
      fakeFingerprintStore(),
      fakeFingerprintInjector()
    );

    const [firstPage, secondPage] = await Promise.all([
      manager.open('xiaomi', 'https://i.mi.com/note/h5#/', 'headless'),
      manager.open('xiaomi', 'https://i.mi.com/note/h5#/', 'headless')
    ]);

    expect(launcher.launchPersistentContext).toHaveBeenCalledOnce();
    expect(firstPage).toBe(secondPage);
    await manager.disposeAll();
  });

  it('认证成功后可立即保存当前会话快照', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const manager = new SessionManager(
      { headless: false },
      root,
      { launchPersistentContext: vi.fn(async () => fakeContext(fakePage())) },
      fakeFingerprintStore(),
      fakeFingerprintInjector()
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/', 'headless');
    await manager.persist('xiaomi');

    await expect(stat(join(root, 'xiaomi', 'notechange-session.json'))).resolves.toBeDefined();
    await manager.disposeAll();
  });

  it('并发持久化同一厂商会话时不会竞争同一个临时文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const manager = new SessionManager(
      { headless: false },
      root,
      { launchPersistentContext: vi.fn(async () => fakeContext(fakePage())) },
      fakeFingerprintStore(),
      fakeFingerprintInjector()
    );

    await manager.open('vivo', 'https://pc.vivo.com.cn/suite?origin=cloudWeb#/note', 'headless');

    await expect(
      Promise.all(Array.from({ length: 8 }, () => manager.persist('vivo')))
    ).resolves.toHaveLength(8);
    await expect(stat(join(root, 'vivo', 'notechange-session.json'))).resolves.toBeDefined();
    await manager.disposeAll();
  });

  it('忽略 Chrome channel，始终使用应用内置 Chromium', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const context = fakeContext(fakePage());
    const launcher = {
      launchPersistentContext: vi
        .fn()
        .mockResolvedValueOnce(context)
    };
    const manager = new SessionManager(
      { headless: false, channel: 'chrome' },
      root,
      launcher,
      fakeFingerprintStore(),
      fakeFingerprintInjector()
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');

    expect(launcher.launchPersistentContext).toHaveBeenCalledOnce();
    expect(launcher.launchPersistentContext.mock.calls[0][1]).not.toHaveProperty('channel');
    await manager.disposeAll();
  });

  it('退出登录时清除浏览器 Cookie 和本地会话快照', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const context = fakeContext(fakePage());
    const manager = new SessionManager(
      { headless: false },
      root,
      { launchPersistentContext: vi.fn(async () => context) },
      fakeFingerprintStore(),
      fakeFingerprintInjector()
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/', 'headless');
    await manager.persist('xiaomi');
    await manager.logout('xiaomi');

    expect(context.clearCookies).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    await expect(stat(join(root, 'xiaomi', 'notechange-session.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('closes the context and removes its fingerprint when clearing cookies fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const context = fakeContext(fakePage());
    const clearCookiesError = new Error('clear cookies failed');
    context.clearCookies.mockRejectedValueOnce(clearCookiesError);
    const fingerprints = fakeFingerprintStore();
    const manager = new SessionManager(
      { headless: false },
      root,
      { launchPersistentContext: vi.fn(async () => context) },
      fingerprints,
      fakeFingerprintInjector()
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/', 'headless');

    await expect(manager.logout('xiaomi')).rejects.toBe(clearCookiesError);

    expect(context.close).toHaveBeenCalledOnce();
    expect(fingerprints.remove).toHaveBeenCalledWith(join(root, 'xiaomi'));
  });

  it('removes the fingerprint after a session snapshot deletion failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const context = fakeContext(fakePage());
    const fingerprints = fakeFingerprintStore();
    const manager = new SessionManager(
      { headless: false },
      root,
      { launchPersistentContext: vi.fn(async () => context) },
      fingerprints,
      fakeFingerprintInjector()
    );
    const sessionFile = join(root, 'xiaomi', 'notechange-session.json');

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/', 'headless');
    await manager.persist('xiaomi');
    await rm(sessionFile);
    await mkdir(sessionFile);

    await expect(manager.logout('xiaomi')).rejects.toMatchObject({ code: 'ERR_FS_EISDIR' });

    expect(context.close).toHaveBeenCalledOnce();
    expect(fingerprints.remove).toHaveBeenCalledWith(join(root, 'xiaomi'));
  });

  it('removes the fingerprint after an inactive session snapshot deletion failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const fingerprints = fakeFingerprintStore();
    const manager = new SessionManager(
      { headless: false },
      root,
      { launchPersistentContext: vi.fn(async () => fakeContext(fakePage())) },
      fingerprints,
      fakeFingerprintInjector()
    );
    const sessionFile = join(root, 'xiaomi', 'notechange-session.json');

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/', 'headless');
    await manager.disposeAll();
    await rm(sessionFile);
    await mkdir(sessionFile);

    await expect(manager.logout('xiaomi')).rejects.toMatchObject({ code: 'ERR_FS_EISDIR' });

    expect(fingerprints.remove).toHaveBeenCalledWith(join(root, 'xiaomi'));
  });

  it('removes only the logged-out provider fingerprint snapshot in both logout paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const fingerprints = fakeFingerprintStore();
    const manager = new SessionManager(
      { headless: false },
      root,
      {
        launchPersistentContext: vi
          .fn()
          .mockResolvedValueOnce(fakeContext(fakePage()))
          .mockResolvedValueOnce(fakeContext(fakePage()))
      },
      fingerprints,
      fakeFingerprintInjector()
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');
    await manager.open('vivo', 'https://pc.vivo.com.cn/suite#/note');
    await manager.logout('xiaomi');
    await manager.disposeAll();
    await manager.logout('vivo');

    expect(fingerprints.remove).toHaveBeenNthCalledWith(1, join(root, 'xiaomi'));
    expect(fingerprints.remove).toHaveBeenNthCalledWith(2, join(root, 'vivo'));
  });

  it('closes a new context when fingerprint injection fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const context = fakeContext(fakePage());
    const injectionError = new Error('injection failed');
    const manager = new SessionManager(
      { headless: false },
      root,
      { launchPersistentContext: vi.fn(async () => context) },
      fakeFingerprintStore(),
      { attachFingerprintToPlaywright: vi.fn(async () => Promise.reject(injectionError)) }
    );

    await expect(manager.open('xiaomi', 'https://i.mi.com/note/h5#/')).rejects.toThrow(injectionError);

    expect(context.close).toHaveBeenCalledOnce();
  });
});

function fakePage(): Page & { goto: ReturnType<typeof vi.fn> } {
  return { goto: vi.fn(async () => null) } as unknown as Page & {
    goto: ReturnType<typeof vi.fn>;
  };
}

function fakeContext(
  page: Page,
  cookies: Awaited<ReturnType<BrowserContext['cookies']>> = []
): BrowserContext & {
  cookies: ReturnType<typeof vi.fn>;
  addCookies: ReturnType<typeof vi.fn>;
  clearCookies: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  setExtraHTTPHeaders: ReturnType<typeof vi.fn>;
  addInitScript: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  browser: ReturnType<typeof vi.fn>;
} {
  return {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    cookies: vi.fn(async () => cookies),
    addCookies: vi.fn(async () => undefined),
    clearCookies: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    setExtraHTTPHeaders: vi.fn(async () => undefined),
    addInitScript: vi.fn(async () => undefined),
    on: vi.fn(),
    browser: vi.fn(() => undefined)
  } as unknown as BrowserContext & {
    cookies: ReturnType<typeof vi.fn>;
    addCookies: ReturnType<typeof vi.fn>;
    clearCookies: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    setExtraHTTPHeaders: ReturnType<typeof vi.fn>;
    addInitScript: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    browser: ReturnType<typeof vi.fn>;
  };
}

function fakeFingerprintStore(fingerprint = fixtureFingerprint()) {
  return {
    loadOrCreate: vi.fn(async () => fingerprint),
    remove: vi.fn(async () => undefined)
  };
}

function fakeFingerprintInjector() {
  return { attachFingerprintToPlaywright: vi.fn(async () => undefined) };
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
