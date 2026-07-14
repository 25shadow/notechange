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
});
