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
  });
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
