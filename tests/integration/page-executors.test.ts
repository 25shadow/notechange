import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionManager } from '../../src/main/browser/session-manager';
import { VivoPageExecutor } from '../../src/main/providers/vivo/vivo-page-executor';
import { XiaomiPageExecutor } from '../../src/main/providers/xiaomi/xiaomi-page-executor';
import type { OperationContract } from '../../src/main/contracts/schema';

describe.skipIf(process.env.CODEX_SANDBOX === 'seatbelt')('页面契约执行器', () => {
  let server: Server;
  let imageServer: Server;
  let origin: string;
  let imageOrigin: string;
  let sessions: SessionManager;
  const imageSource = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>'
  );
  const secureKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

  beforeEach(async () => {
    imageServer = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/octet-stream');
      response.end(rc4(imageSource, secureKey));
    });
    await new Promise<void>((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
    const imageAddress = imageServer.address();
    if (!imageAddress || typeof imageAddress === 'string') throw new Error('IMAGE_SERVER_MISSING');
    imageOrigin = `http://127.0.0.1:${imageAddress.port}`;

    server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<!doctype html><script>
          const modules = {
            1281: {
              async createSync(payload) {
                const response = await fetch('/note-api/sync/createSync/v2', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ jvq_param: 'official:' + btoa(JSON.stringify(payload)) })
                });
                return response.json();
              }
            },
            137: {
              default: {
                async requestBranch({ url, data }) {
                  const response = await fetch('/note-api' + url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                  });
                  return response.json();
                }
              }
            }
          };
          window.__notechangeWebpackRequire = (id) => modules[id];
        </script>`);
        return;
      }

      if (request.method === 'GET' && request.url?.startsWith('/xiaomi')) {
        const url = new URL(request.url, 'http://localhost');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ cursor: url.searchParams.get('syncTag') }));
        return;
      }

      if (request.method === 'GET' && request.url?.startsWith('/file/full/v2?')) {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            code: 0,
            data: {
              kss: {
                stat: 'OK',
                secure_key: secureKey.toString('hex'),
                blocks: [{ urls: [`${imageOrigin}/note-image.kss`], size: imageSource.length }]
              }
            }
          })
        );
        return;
      }

      if (request.method === 'POST') {
        let body = '';
        request.on('data', (chunk) => {
          body += chunk;
        });
        request.on('end', () => {
          const parsed = JSON.parse(body) as Record<string, unknown>;
          response.setHeader('Content-Type', 'application/json');
          response.end(
            JSON.stringify(
              request.url === '/note-api/sync/createSync/v2'
                ? { wrappedOnly: Object.keys(parsed).join(',') === 'jvq_param' }
                : parsed
            )
          );
        });
        return;
      }

      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TEST_SERVER_MISSING');
    origin = `http://127.0.0.1:${address.port}`;
    sessions = new SessionManager({ headless: true });
  });

  afterEach(async () => {
    await sessions.disposeAll();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await new Promise<void>((resolve, reject) =>
      imageServer.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it('按小米契约在同源页面内发送查询', async () => {
    const page = await sessions.open('xiaomi-executor', origin);
    const executor = new XiaomiPageExecutor(page);
    const operation: OperationContract = {
      name: 'listNotes',
      method: 'GET',
      path: '/xiaomi',
      verification: 'network-verified'
    };

    await expect(
      executor.call(operation, { query: { syncTag: 'synthetic-cursor' } })
    ).resolves.toEqual({ cursor: 'synthetic-cursor' });
  }, 15_000);

  it('按 KSS 元数据下载并解包小米附件字节', async () => {
    const page = await sessions.open('xiaomi-image-executor', origin);
    const executor = new XiaomiPageExecutor(page);
    const operation: OperationContract = {
      name: 'downloadImage',
      method: 'GET',
      path: '/file/full/v2',
      verification: 'source-verified'
    };

    const bytes = await executor.call<Uint8Array>(operation, {
      query: { type: 'note_img', fileid: 'synthetic-image' }
    });

    expect(Buffer.from(bytes)).toEqual(imageSource);
  }, 15_000);

  it('只在页面上下文中生成 vivo 加密外层', async () => {
    const page = await sessions.open('vivo-executor', origin);
    const executor = new VivoPageExecutor(page);
    const operation: OperationContract = {
      name: 'createSync',
      method: 'POST',
      path: '/sync/createSync/v2',
      wireBodyKeys: ['jvq_param'],
      verification: 'network-verified'
    };

    await expect(executor.call(operation, { type: 0, notes: [] })).resolves.toEqual({
      wrappedOnly: true
    });
  }, 15_000);
});

function rc4(input: Uint8Array, key: Uint8Array): Buffer {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const output = Buffer.alloc(input.length);
  let i = 0;
  j = 0;
  for (let offset = 0; offset < input.length; offset += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    output[offset] = input[offset] ^ state[(state[i] + state[j]) & 0xff];
  }
  return output;
}
