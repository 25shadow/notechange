import { describe, expect, it } from 'vitest';

import { isProbableDuplicate } from '../../src/main/migration/duplicates';

describe('isProbableDuplicate', () => {
  it('将相同内容哈希识别为重复', () => {
    expect(
      isProbableDuplicate({ contentHash: 'a'.repeat(64) }, { contentHash: 'a'.repeat(64) })
    ).toBe(true);
  });

  it('不会将不同内容哈希识别为重复', () => {
    expect(
      isProbableDuplicate({ contentHash: 'a'.repeat(64) }, { contentHash: 'b'.repeat(64) })
    ).toBe(false);
  });
});
