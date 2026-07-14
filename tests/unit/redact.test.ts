import { describe, expect, it } from 'vitest';

import { redactForLog } from '../../src/main/security/redact';

describe('redactForLog', () => {
  it('不会在日志对象中保留凭据或笔记内容', () => {
    const sentinel = 'DO_NOT_LEAK_7d93';
    const output = redactForLog({
      cookie: `session=${sentinel}`,
      token: sentinel,
      title: sentinel,
      body: sentinel,
      filename: sentinel,
      operation: 'listNotes'
    });

    expect(JSON.stringify(output)).not.toContain(sentinel);
    expect(output).toMatchObject({ operation: 'listNotes' });
  });
});
