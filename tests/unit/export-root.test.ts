import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { exportRoot } from '../../src/main/storage/export-root';

describe('exportRoot', () => {
  it('位于 Electron userData 的 exports 子目录', () => {
    expect(exportRoot('/tmp/notechange')).toBe(join('/tmp/notechange', 'exports'));
  });
});
