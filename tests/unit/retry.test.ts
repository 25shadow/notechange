import { describe, expect, it } from 'vitest';

import { retryTransient } from '../../src/main/migration/retry';

describe('retryTransient', () => {
  it('只重试限流和临时网络错误', async () => {
    let attempts = 0;
    const result = await retryTransient(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('RATE_LIMITED');
        return 'ok';
      },
      { delays: [0, 0, 0, 0], sleep: async () => {} }
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('不会重试格式错误', async () => {
    let attempts = 0;

    await expect(
      retryTransient(async () => {
        attempts += 1;
        throw new Error('FORMAT_INVALID');
      })
    ).rejects.toThrow('FORMAT_INVALID');
    expect(attempts).toBe(1);
  });
});
