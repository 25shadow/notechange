import { describe, expect, it } from 'vitest';
// @ts-expect-error The standalone Node service is intentionally plain ESM JavaScript.
import { resolveBuildPublicKey } from '../../license-server/build-config.mjs';

describe('build public key configuration', () => {
  it('uses an explicitly supplied public key instead of local server storage', async () => {
    await expect(resolveBuildPublicKey({ NOTECHANGE_LICENSE_PUBLIC_KEY: 'PUBLIC-KEY' }, '/missing')).resolves.toBe('PUBLIC-KEY');
  });
});
