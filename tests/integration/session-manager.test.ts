import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionManager } from '../../src/main/browser/session-manager';
import { runSameOrigin } from '../../src/main/browser/same-origin-executor';

describe('SessionManager', () => {
  let server: Server;
  let origin: string;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Set-Cookie', 'session=local-test-secret; HttpOnly; SameSite=Lax');
        response.end('<!doctype html><title>local</title>');
        return;
      }

      if (request.url === '/api/me' && request.headers.cookie === 'session=local-test-secret') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ authenticated: true }));
        return;
      }

      response.statusCode = 401;
      response.end(JSON.stringify({ authenticated: false }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_MISSING');
    origin = `http://127.0.0.1:${address.port}`;
    sessionManager = new SessionManager({ headless: true });
  });

  afterEach(async () => {
    await sessionManager.disposeAll();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it('在页面上下文中使用 HttpOnly 登录态调用同源接口', async () => {
    const page = await sessionManager.open('test', origin);

    await expect(runSameOrigin(page, '/api/me', { method: 'GET' })).resolves.toEqual({
      authenticated: true
    });
  });
});
