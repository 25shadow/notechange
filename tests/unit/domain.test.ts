import { describe, expect, it } from 'vitest';

import { canonicalNoteSchema } from '../../src/shared/domain';

describe('canonicalNoteSchema', () => {
  it('拒绝缺少内容哈希的笔记', () => {
    const result = canonicalNoteSchema.safeParse({
      sourceId: 'n1',
      folderSourceId: null,
      title: '测试',
      html: '<p>正文</p>',
      plainText: '正文',
      attachments: [],
      createdAt: null,
      modifiedAt: null,
      warnings: []
    });

    expect(result.success).toBe(false);
  });
});
