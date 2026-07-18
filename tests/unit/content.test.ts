import { describe, expect, it } from 'vitest';

import { normalizeContent } from '../../src/main/migration/content';

describe('normalizeContent', () => {
  it('移除脚本并保留段落和列表', () => {
    const output = normalizeContent(
      '<p>正文</p><script>secret()</script><ul><li>A</li></ul>'
    );

    expect(output.html).toBe('<p>正文</p><ul><li>A</li></ul>');
    expect(output.plainText).toContain('正文');
    expect(output.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('为不支持的音频内容生成警告', () => {
    const output = normalizeContent('<p>正文</p><audio src="voice.mp3"></audio>');

    expect(output.warnings).toContainEqual(
      expect.objectContaining({ code: 'unsupported-content' })
    );
  });

  it('兼容小米旧版 b 和 size 标签', () => {
    const output = normalizeContent('<p><b>粗体</b><size>大字</size></p>');

    expect(output.html).toBe('<p><strong>粗体</strong>大字</p>');
    expect(output.plainText).toBe('粗体大字');
    expect(output.warnings).toEqual([]);
  });

  it('不把小米正文结构标签误报为无法迁移', () => {
    const output = normalizeContent(
      '<text>正文</text><background>背景字</background><mid-size>小米字</mid-size><new-format>新格式</new-format><order>排序</order>'
    );

    expect(output.plainText).toBe('正文背景字小米字新格式排序');
    expect(output.warnings).toEqual([]);
  });
});
