import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { browserProfileRoot } from '../../src/main/browser/profile-root';

describe('browserProfileRoot', () => {
  it('把浏览器 profile 保存在 Electron userData 下', () => {
    const userDataDirectory = join('/Users', 'test', 'Library', 'Application Support', 'notechange');

    expect(browserProfileRoot(userDataDirectory)).toBe(
      join(userDataDirectory, 'browser-profiles')
    );
  });
});
