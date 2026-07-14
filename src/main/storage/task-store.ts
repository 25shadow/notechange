import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { EncryptedFile } from './encrypted-file';
import type { SecretProtector } from './protector';

export type TaskItemStatus =
  | 'pending'
  | 'running'
  | 'created'
  | 'skipped'
  | 'failed'
  | 'manual-review';

export type TaskItem = {
  id: string;
  title: string;
  body: string;
  status: TaskItemStatus;
};

const transitions: Record<TaskItemStatus, ReadonlySet<TaskItemStatus>> = {
  pending: new Set(['running']),
  running: new Set(['created', 'skipped', 'failed', 'manual-review']),
  created: new Set(),
  skipped: new Set(),
  failed: new Set(),
  'manual-review': new Set()
};

export class TaskStore {
  private readonly taskPath: string;
  private readonly temporaryPath: string;
  private readonly encryptedFile: EncryptedFile;

  constructor(
    private readonly directory: string,
    protector: SecretProtector
  ) {
    this.taskPath = join(directory, 'task.enc');
    this.temporaryPath = join(directory, 'task.tmp');
    this.encryptedFile = new EncryptedFile(join(directory, 'task.key'), protector);
  }

  async save(items: TaskItem[]): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const encrypted = await this.encryptedFile.encrypt(Buffer.from(JSON.stringify({ items })));
    const handle = await open(this.temporaryPath, 'w', 0o600);

    try {
      await handle.writeFile(encrypted);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(this.temporaryPath, this.taskPath);
    } catch (error) {
      await rm(this.temporaryPath, { force: true });
      throw error;
    }
  }

  async listRemaining(): Promise<TaskItem[]> {
    const items = await this.load();
    return items.filter(({ status }) => status === 'pending' || status === 'running');
  }

  async transition(id: string, nextStatus: TaskItemStatus): Promise<void> {
    const items = await this.load();
    const item = items.find((candidate) => candidate.id === id);
    if (!item) throw new Error('TASK_ITEM_NOT_FOUND');
    if (!transitions[item.status].has(nextStatus)) {
      throw new Error(`INVALID_TASK_TRANSITION:${item.status}:${nextStatus}`);
    }

    item.status = nextStatus;
    await this.save(items);
  }

  private async load(): Promise<TaskItem[]> {
    try {
      const plaintext = await this.encryptedFile.decrypt(await readFile(this.taskPath));
      const snapshot = JSON.parse(plaintext.toString('utf8')) as { items: TaskItem[] };
      return snapshot.items;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw error;
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
