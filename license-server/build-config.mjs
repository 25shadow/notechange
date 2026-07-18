import { readPublicKey } from './key-store.mjs';

export async function resolveBuildPublicKey(environment, dataDir) {
  return environment.NOTECHANGE_LICENSE_PUBLIC_KEY || readPublicKey(dataDir);
}
