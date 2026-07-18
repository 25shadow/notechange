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

  it('将纯文本行转换为 vivo 段落', () => {
    const output = normalizeContent('第一段\n第二段');

    expect(output.html).toBe('<p>第一段</p><p>第二段</p>');
  });

  it('将纯文本空行保留为空段落', () => {
    const output = normalizeContent('第一段\n\n第二段');

    expect(output.html).toBe('<p>第一段</p><p><br></p><p>第二段</p>');
  });

  it('保留空输入为空 HTML', () => {
    const output = normalizeContent('');

    expect(output.html).toBe('');
  });

  it('按 CRLF 和单独 CR 分隔纯文本段落', () => {
    const output = normalizeContent('第一段\r\n第二段\r第三段');

    expect(output.html).toBe('<p>第一段</p><p>第二段</p><p>第三段</p>');
  });

  it('将仅含空白的行作为段落内容保留', () => {
    const output = normalizeContent('第一段\n   \n第二段');

    expect(output.html).toBe('<p>第一段</p><p>   </p><p>第二段</p>');
  });

  it('转义纯文本中的 HTML 特殊字符', () => {
    const output = normalizeContent('a < b & c');

    expect(output.html).toBe('<p>a &lt; b &amp; c</p>');
  });

  it('不把小米正文结构标签误报为无法迁移', () => {
    const output = normalizeContent(
      '<text>正文</text><background>背景字</background><mid-size>小米字</mid-size><new-format>新格式</new-format><order>排序</order>'
    );

    expect(output.plainText).toBe('正文背景字小米字新格式排序');
    expect(output.warnings).toEqual([]);
  });
});
