// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionManager } from '../../src/main/browser/session-manager';
import { runSameOrigin } from '../../src/main/browser/same-origin-executor';

describe.skipIf(process.env.CODEX_SANDBOX === 'seatbelt')('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager({ headless: true });
  });

  afterEach(async () => {
    await sessionManager.disposeAll();
  });

  it('在页面上下文中使用 HttpOnly 登录态调用同源接口', async () => {
    const page = await sessionManager.open('test', 'about:blank');
    await page.context().addCookies([
      {
        name: 'session',
        value: 'local-test-secret',
        url: 'https://notechange.test',
        httpOnly: true,
        sameSite: 'Lax'
      }
    ]);
    await routeTestOrigin(page);
    await page.goto('https://notechange.test/');

    expect(sessionManager.getPage('test')).toBe(page);

    await expect(runSameOrigin(page, '/api/me', { method: 'GET' })).resolves.toEqual({
      authenticated: true
    });
    await expect(page.context().cookies('https://notechange.test')).resolves.toEqual([
      expect.objectContaining({
        name: 'session',
        value: 'local-test-secret',
        httpOnly: true
      })
    ]);

    const headlessPage = await sessionManager.switchToHeadless('test', 'about:blank');
    expect(headlessPage).not.toBe(page);
    expect(page.isClosed()).toBe(true);
    await expect(headlessPage.context().cookies('https://notechange.test')).resolves.toEqual([
      expect.objectContaining({
        name: 'session',
        value: 'local-test-secret',
        httpOnly: true
      })
    ]);
    await routeTestOrigin(headlessPage);
    await headlessPage.goto('https://notechange.test/');
    await expect(runSameOrigin(headlessPage, '/api/me', { method: 'GET' })).resolves.toEqual({
      authenticated: true
    });
  }, 15_000);

  it('关闭应用上下文后从固定 profile 恢复会话 Cookie', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notechange-persistent-session-'));
    const firstManager = new SessionManager({ headless: true }, root);
    const secondManager = new SessionManager({ headless: true }, root);

    try {
      const firstPage = await firstManager.open('xiaomi', 'about:blank', 'headless');
      await firstPage.context().addCookies([
        {
          name: 'session',
          value: 'persistent-test-secret',
          url: 'https://notechange.test',
          httpOnly: true,
          sameSite: 'Lax'
        }
      ]);
      await firstManager.disposeAll();

      const restoredPage = await secondManager.open('xiaomi', 'about:blank', 'headless');
      await expect(restoredPage.context().cookies('https://notechange.test')).resolves.toEqual([
        expect.objectContaining({
          name: 'session',
          value: 'persistent-test-secret',
          httpOnly: true
        })
      ]);
    } finally {
      await firstManager.disposeAll();
      await secondManager.disposeAll();
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});

async function routeTestOrigin(page: import('playwright').Page) {
  await page.route('https://notechange.test/**', async (route) => {
    const cookie = route.request().headers().cookie;
    if (route.request().url().endsWith('/api/me')) {
      await route.fulfill({
        status: cookie === 'session=local-test-secret' ? 200 : 401,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: cookie === 'session=local-test-secret' })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>local</title>' });
  });
}
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
