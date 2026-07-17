import { describe, expect, it } from 'vitest';

import { parseXiaomiNoteTitle } from '../../src/main/migration/note-title';

describe('parseXiaomiNoteTitle', () => {
  it('从 extraInfo JSON 的 title 字段读取真实标题', () => {
    expect(
      parseXiaomiNoteTitle('{"title":" 真实标题 ","note_content_type":"common"}')
    ).toBe('真实标题');
  });

  it('title 为空时返回无标题', () => {
    expect(parseXiaomiNoteTitle('{"title":""}')).toBe('无标题');
  });

  it('extraInfo 不是合法 JSON 时返回无标题', () => {
    expect(parseXiaomiNoteTitle('not-json')).toBe('无标题');
  });
});
