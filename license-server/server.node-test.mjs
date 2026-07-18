import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('new activation codes are retained and returned to an authenticated administrator', async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'notechange-license-test-'));
  const port = 18000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ['license-server/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, LICENSE_PORT: String(port), LICENSE_DATA_DIR: dataDirectory },
    stdio: 'ignore'
  });
  t.after(async () => {
    server.kill();
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const origin = `http://127.0.0.1:${port}`;
  await waitForHealth(origin);
  const setup = await fetch(`${origin}/v1/admin/setup`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'admin password' })
  });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get('set-cookie');
  assert.ok(cookie);
  const headers = { cookie, 'content-type': 'application/json' };
  const created = await fetch(`${origin}/v1/admin/codes`, {
    method: 'POST', headers, body: JSON.stringify({ quantity: 1, note: 'first batch' })
  });
  const createdBody = await created.json();
  assert.equal(created.status, 201);
  assert.match(createdBody.codes[0].code, /^NC-(?:[A-Z0-9]{4}-){4}[A-Z0-9]{4}$/);

  const listed = await fetch(`${origin}/v1/admin/codes`, { headers });
  const listedBody = await listed.json();
  assert.equal(listed.status, 200);
  assert.equal(listedBody.codes[0].code, createdBody.codes[0].code);

  const database = JSON.parse(await readFile(join(dataDirectory, 'licenses.json'), 'utf8'));
  assert.equal(database.codes[0].code, createdBody.codes[0].code);

  const removed = await fetch(`${origin}/v1/admin/codes/${listedBody.codes[0].codeHash}`, {
    method: 'DELETE', headers
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { ok: true });

  const afterRemoval = await fetch(`${origin}/v1/admin/codes`, { headers });
  assert.deepEqual((await afterRemoval.json()).codes, []);
});

async function waitForHealth(origin) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw lastError ?? new Error('server did not start');
}
