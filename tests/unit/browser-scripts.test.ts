import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('浏览器脚本', () => {
  it('vivo 导入通过官方请求模块创建笔记', async () => {
    const source = await readFile(resolve('scripts/browser/vivo-import.js'), 'utf8');

    expect(source).toContain('createSync');
    expect(source).toContain('requestBranch');
    expect(source).not.toContain('VNoteServerMaodun.encrypt');
    expect(source).not.toContain('serviceToken');
  });
});
