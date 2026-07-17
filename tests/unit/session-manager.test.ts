import { mkdtemp, rm } from 'node:fs/promises';
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
  close: ReturnType<typeof vi.fn>;
} {
  return {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    cookies: vi.fn(async () => cookies),
    addCookies: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined)
  } as unknown as BrowserContext & {
    cookies: ReturnType<typeof vi.fn>;
    addCookies: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}
