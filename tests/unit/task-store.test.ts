import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { SecretProtector } from '../../src/main/storage/protector';
import { TaskStore } from '../../src/main/storage/task-store';

class TestProtector implements SecretProtector {
  protect(value: Buffer): Buffer {
    return Buffer.from(value.map((byte) => byte ^ 0x5a));
  }

  unprotect(value: Buffer): Buffer {
    return this.protect(value);
  }
}

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('TaskStore', () => {
  it('加密保存任务并只恢复尚未完成的条目', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'notechange-task-'));
    directories.push(directory);
    const store = new TaskStore(directory, new TestProtector());
    await store.save([
      { id: '1', title: '机密标题', body: '机密正文', status: 'pending' },
      { id: '2', title: '第二条', body: '内容二', status: 'pending' },
      { id: '3', title: '第三条', body: '内容三', status: 'pending' }
    ]);

    await store.transition('1', 'running');
    await store.transition('1', 'created');

    const reopened = new TaskStore(directory, new TestProtector());
    expect((await reopened.listRemaining()).map(({ id }) => id)).toEqual(['2', '3']);

    const encrypted = await readFile(join(directory, 'task.enc'));
    expect(encrypted.includes(Buffer.from('机密标题'))).toBe(false);
    expect(encrypted.includes(Buffer.from('机密正文'))).toBe(false);
  });

  it('拒绝跳过 running 状态直接完成任务', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'notechange-task-'));
    directories.push(directory);
    const store = new TaskStore(directory, new TestProtector());
    await store.save([{ id: '1', title: '标题', body: '正文', status: 'pending' }]);

    await expect(store.transition('1', 'created')).rejects.toThrow(
      'INVALID_TASK_TRANSITION:pending:created'
    );
  });
});
