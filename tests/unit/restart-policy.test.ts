import { describe, expect, it } from 'vitest';
// @ts-expect-error The standalone Node service is intentionally plain ESM JavaScript.
import { shouldRestartAfterExit, updateRestartExitCode } from '../../license-server/restart-policy.mjs';

describe('license server restart policy', () => {
  it('restarts only after the dedicated update exit code', () => {
    expect(shouldRestartAfterExit(updateRestartExitCode)).toBe(true);
    expect(shouldRestartAfterExit(0)).toBe(false);
    expect(shouldRestartAfterExit(1)).toBe(false);
  });
});
