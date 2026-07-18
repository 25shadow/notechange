import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright';

import { SessionManager } from '../../src/main/browser/session-manager';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SessionManager headless transition', () => {
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
    const manager = new SessionManager({ headless: false }, root, launcher);

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
    const manager = new SessionManager({ headless: false }, root, launcher);

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
    const manager = new SessionManager({ headless: false }, root, launcher);

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');
    await manager.open('vivo', 'https://pc.vivo.com.cn/suite#/note');

    expect(launcher.launchPersistentContext.mock.calls[0][0]).toBe(join(root, 'xiaomi'));
    expect(launcher.launchPersistentContext.mock.calls[1][0]).toBe(join(root, 'vivo'));
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
    const manager = new SessionManager({ headless: false }, root, launcher);

    await manager.open('vivo', 'https://pc.vivo.com.cn/suite#/note', 'headless');
    await manager.switchToHeaded('vivo', 'https://pc.vivo.com.cn/suite#/note');

    expect(launcher.launchPersistentContext.mock.calls[0][1]).toMatchObject({ headless: true });
    expect(launcher.launchPersistentContext.mock.calls[1][1]).toMatchObject({ headless: false });
    expect(launcher.launchPersistentContext.mock.calls[1][0]).toBe(
      launcher.launchPersistentContext.mock.calls[0][0]
    );
    await manager.disposeAll();
  });

  it('并发打开同一个厂商时只启动一个 Chromium 上下文', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const sharedPage = fakePage();
    const launcher = {
      launchPersistentContext: vi.fn(async () => fakeContext(sharedPage))
    };
    const manager = new SessionManager({ headless: false }, root, launcher);

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
      { launchPersistentContext: vi.fn(async () => fakeContext(fakePage())) }
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/', 'headless');
    await manager.persist('xiaomi');

    await expect(stat(join(root, 'xiaomi', 'notechange-session.json'))).resolves.toBeDefined();
    await manager.disposeAll();
  });

  it('系统 Chrome 缺失时回退到 Playwright 自带 Chromium', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const context = fakeContext(fakePage());
    const launcher = {
      launchPersistentContext: vi
        .fn()
        .mockRejectedValueOnce(new Error("Executable doesn't exist at /Applications/Google Chrome.app"))
        .mockResolvedValueOnce(context)
    };
    const manager = new SessionManager({ headless: false, channel: 'chrome' }, root, launcher);

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');

    expect(launcher.launchPersistentContext).toHaveBeenCalledTimes(2);
    expect(launcher.launchPersistentContext.mock.calls[0][1]).toMatchObject({ channel: 'chrome' });
    expect(launcher.launchPersistentContext.mock.calls[1][1]).not.toHaveProperty('channel');
    await manager.disposeAll();
  });

  it('退出登录时清除浏览器 Cookie 和本地会话快照', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-session-test-'));
    directories.push(root);
    const context = fakeContext(fakePage());
    const manager = new SessionManager(
      { headless: false },
      root,
      { launchPersistentContext: vi.fn(async () => context) }
    );

    await manager.open('xiaomi', 'https://i.mi.com/note/h5#/', 'headless');
    await manager.persist('xiaomi');
    await manager.logout('xiaomi');

    expect(context.clearCookies).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    await expect(stat(join(root, 'xiaomi', 'notechange-session.json'))).rejects.toMatchObject({ code: 'ENOENT' });
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
} {
  return {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    cookies: vi.fn(async () => cookies),
    addCookies: vi.fn(async () => undefined),
    clearCookies: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined)
  } as unknown as BrowserContext & {
    cookies: ReturnType<typeof vi.fn>;
    addCookies: ReturnType<typeof vi.fn>;
    clearCookies: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}
