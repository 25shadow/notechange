import assert from 'node:assert/strict';
import test from 'node:test';
import { npmInstallCommand } from './npm-install.mjs';

test('uses a service-owned npm cache instead of the global npm cache', () => {
  const command = npmInstallCommand('/var/lib/notechange-license', { npm_execpath: '/opt/node/npm-cli.js' });

  assert.equal(command.command, process.execPath);
  assert.deepEqual(command.args, ['/opt/node/npm-cli.js', 'ci', '--cache', '/var/lib/notechange-license/npm-cache']);
  assert.equal(command.env.npm_config_cache, '/var/lib/notechange-license/npm-cache');
});
