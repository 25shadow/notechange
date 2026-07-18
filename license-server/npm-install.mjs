import { join } from 'node:path';

export function npmInstallCommand(dataDirectory, environment = process.env) {
  const cacheDirectory = join(dataDirectory, 'npm-cache');
  const args = environment.npm_execpath
    ? [environment.npm_execpath, 'ci', '--cache', cacheDirectory]
    : ['ci', '--cache', cacheDirectory];

  return {
    command: environment.npm_execpath ? process.execPath : 'npm',
    args,
    displayCommand: `npm ci --cache ${cacheDirectory}`,
    env: { ...environment, npm_config_cache: cacheDirectory }
  };
}
