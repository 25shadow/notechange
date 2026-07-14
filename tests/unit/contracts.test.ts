import { describe, expect, it } from 'vitest';

import {
  assertWriteVerified,
  parseProviderContract
} from '../../src/main/contracts/loader';

describe('parseProviderContract', () => {
  it('拒绝没有验证等级的操作', () => {
    expect(() =>
      parseProviderContract({
        provider: 'xiaomi',
        operations: [{ name: 'x', method: 'GET', path: '/x' }]
      })
    ).toThrow();
  });
});

describe('assertWriteVerified', () => {
  it('拒绝只有源码验证的写操作', () => {
    expect(() =>
      assertWriteVerified({ name: 'createFolder', verification: 'source-verified' })
    ).toThrow('CONTRACT_WRITE_NOT_VERIFIED:createFolder');
  });
});
