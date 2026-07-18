import { describe, expect, it } from 'vitest';

import { splitInlineAttachments } from '../../src/renderer/inline-attachments';

const attachments = [
  { sourceId: 'file-a', sha256: 'a'.repeat(64), filename: 'a.jpg', mimeType: 'image/jpeg' },
  { sourceId: 'file-b', sha256: 'b'.repeat(64), filename: 'b.png', mimeType: 'image/png' },
  { sourceId: 'voice', sha256: 'c'.repeat(64), filename: 'voice.mp3', mimeType: 'audio/mp3' }
];

describe('splitInlineAttachments', () => {
  it('按正文中的文件 ID 顺序拆分文本和附件', () => {
    expect(
      splitInlineAttachments('前文\n☺ file-a<0/>\n中间\n☺ file-b\n结尾', attachments)
    ).toEqual({
      segments: [
        { type: 'text', value: '前文\n' },
        { type: 'attachment', attachment: attachments[0] },
        { type: 'text', value: '\n中间\n' },
        { type: 'attachment', attachment: attachments[1] },
        { type: 'text', value: '\n结尾' }
      ],
      unreferenced: [attachments[2]]
    });
  });

  it('保留未知和重复的占位符文本', () => {
    const result = splitInlineAttachments('☺ missing\n☺ file-a\n☺ file-a', attachments);

    expect(result.segments).toEqual([
      { type: 'text', value: '☺ missing\n' },
      { type: 'attachment', attachment: attachments[0] },
      { type: 'text', value: '\n☺ file-a' }
    ]);
    expect(result.unreferenced).toEqual([attachments[1], attachments[2]]);
  });
});
