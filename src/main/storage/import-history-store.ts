import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileHandle } from 'node:fs/promises';

import { z } from 'zod';

import type {
  ImportFailure,
  ImportHistoryLog,
  ImportHistoryTask,
  ImportProgress,
  ImportTaskStatus
} from '../../shared/ipc';

export type { ImportHistoryLog } from '../../shared/ipc';
export type StoredImportTask = ImportHistoryTask;

export interface ImportHistoryStore {
  create(task: StoredImportTask): Promise<void>;
  appendProgress(taskId: string, progress: ImportProgress, log?: ImportHistoryLog): Promise<void>;
  appendFailure(taskId: string, failure: ImportFailure): Promise<void>;
  complete(taskId: string, status: ImportTaskStatus, completedAt: string): Promise<void>;
  list(): Promise<StoredImportTask[]>;
  get(taskId: string): Promise<StoredImportTask | null>;
}

const taskIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const importOutcomeSchema = z.enum(['created', 'skipped', 'failed', 'manual-review']);
const attachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string()
});
const taskStatusSchema = z.enum([
  'running',
  'completed',
  'completed-with-issues',
  'cancelled',
  'failed-to-start'
]);
const progressSchema = z.object({
  taskId: taskIdSchema,
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  manualReview: z.number().int().nonnegative(),
  current: z
    .object({
      sourceId: z.string(),
      title: z.string(),
      outcome: importOutcomeSchema.optional(),
      errorCode: z.string().optional(),
      attachment: attachmentSchema.optional()
    })
    .nullable(),
  occurredAt: z.string().datetime()
});
const failureSchema = z.object({
  sourceId: z.string(),
  title: z.string(),
  outcome: z.enum(['failed', 'manual-review']),
  errorCode: z.string(),
  message: z.string(),
  attachment: attachmentSchema.optional(),
  occurredAt: z.string().datetime()
});
const logSchema = z.object({
  occurredAt: z.string().datetime(),
  message: z.string(),
  kind: z.enum(['info', 'success', 'error'])
});
const storedTaskSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: taskIdSchema,
    batchId: z.string().min(1),
    source: z.literal('xiaomi'),
    target: z.literal('vivo'),
    status: taskStatusSchema,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    progress: progressSchema,
    logs: z.array(logSchema),
    failures: z.array(failureSchema)
  })
  .superRefine((task, context) => {
    const { created, skipped, failed, manualReview, completed, total } = task.progress;
    if (created + skipped + failed + manualReview !== completed || completed > total) {
      context.addIssue({ code: 'custom', message: 'IMPORT_HISTORY_INVALID' });
    }
    if ((task.status === 'running') !== (task.completedAt === null)) {
      context.addIssue({ code: 'custom', message: 'IMPORT_HISTORY_INVALID' });
    }
  });

export class FileImportHistoryStore implements ImportHistoryStore {
  private readonly mutationQueues = new Map<string, Promise<void>>();

  constructor(private readonly rootDirectory: string) {}

  async create(task: StoredImportTask): Promise<void> {
    const stored = storedTaskSchema.parse(task);
    if (stored.progress.taskId !== stored.taskId) throw new Error('IMPORT_HISTORY_INVALID');
    await this.write(stored);
  }

  async appendProgress(
    taskId: string,
    progress: ImportProgress,
    log?: ImportHistoryLog
  ): Promise<void> {
    const parsedProgress = progressSchema.parse(progress);
    const parsedLog = log === undefined ? undefined : logSchema.parse(log);
    await this.mutate(taskId, async (task) => {
      if (parsedProgress.taskId !== task.taskId) throw new Error('IMPORT_HISTORY_INVALID');
      return {
        ...task,
        progress: parsedProgress,
        logs: parsedLog ? [...task.logs, parsedLog] : task.logs
      };
    });
  }

  async appendFailure(taskId: string, failure: ImportFailure): Promise<void> {
    const parsedFailure = failureSchema.parse(failure);
    await this.mutate(taskId, async (task) => ({
      ...task,
      failures: [...task.failures, parsedFailure]
    }));
  }

  async complete(taskId: string, status: ImportTaskStatus, completedAt: string): Promise<void> {
    const parsedCompletedAt = z.string().datetime().parse(completedAt);
    const parsedStatus = taskStatusSchema.parse(status);
    if (parsedStatus === 'running') throw new Error('IMPORT_HISTORY_INVALID');
    await this.mutate(taskId, async (task) => ({
      ...task,
      status: parsedStatus,
      completedAt: parsedCompletedAt
    }));
  }

  async list(): Promise<StoredImportTask[]> {
    let entries;
    try {
      const root = await this.openRoot(false);
      await root.close();
      entries = await readdir(this.rootDirectory, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw new Error('IMPORT_HISTORY_INVALID');
    }

    const tasks = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          const taskId = entry.name.slice(0, -'.json'.length);
          try {
            return await this.get(taskId);
          } catch {
            return null;
          }
        })
    );
    return tasks
      .filter((task): task is StoredImportTask => task !== null)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.taskId.localeCompare(left.taskId));
  }

  async get(taskId: string): Promise<StoredImportTask | null> {
    assertTaskId(taskId);
    const path = this.filePath(taskId);
    let root: FileHandle | undefined;
    let file: FileHandle | undefined;
    try {
      root = await this.openRoot(false);
      file = await open(path, readFlags());
      const info = await file.stat();
      if (!info.isFile()) throw new Error('IMPORT_HISTORY_INVALID');
      const contents = await file.readFile({ encoding: 'utf8' });
      const task = storedTaskSchema.parse(JSON.parse(contents));
      if (task.taskId !== taskId || task.progress.taskId !== taskId) {
        throw new Error('IMPORT_HISTORY_INVALID');
      }
      return task;
    } catch (error) {
      if (isNotFound(error)) return null;
      if (error instanceof Error && error.message === 'IMPORT_HISTORY_INVALID') throw error;
      throw new Error('IMPORT_HISTORY_INVALID');
    } finally {
      await file?.close();
      await root?.close();
    }
  }

  private async require(taskId: string): Promise<StoredImportTask> {
    const task = await this.get(taskId);
    if (!task) throw new Error('IMPORT_HISTORY_MISSING');
    return task;
  }

  private async write(task: StoredImportTask): Promise<void> {
    const stored = storedTaskSchema.parse(task);
    const root = await this.openRoot(true);
    const path = this.filePath(stored.taskId);
    const temporaryPath = join(this.rootDirectory, `.${stored.taskId}.${randomUUID()}.tmp`);
    let temporary: FileHandle | undefined;
    try {
      await this.assertSameRoot(root);
      temporary = await open(temporaryPath, writeFlags(), 0o600);
      await temporary.writeFile(JSON.stringify(stored), { encoding: 'utf8' });
      await temporary.chmod(0o600);
      await temporary.close();
      temporary = undefined;
      await this.assertSameRoot(root);
      await rename(temporaryPath, path);
    } finally {
      await temporary?.close();
      await root.close();
    }
  }

  private filePath(taskId: string): string {
    assertTaskId(taskId);
    return join(this.rootDirectory, `${taskId}.json`);
  }

  private async mutate(
    taskId: string,
    update: (task: StoredImportTask) => Promise<StoredImportTask>
  ): Promise<void> {
    assertTaskId(taskId);
    const previous = this.mutationQueues.get(taskId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.mutationQueues.set(taskId, tail);
    await previous.catch(() => undefined);
    try {
      await this.write(await update(await this.require(taskId)));
    } finally {
      release?.();
      if (this.mutationQueues.get(taskId) === tail) this.mutationQueues.delete(taskId);
    }
  }

  private async openRoot(create: boolean): Promise<FileHandle> {
    try {
      return await this.openExistingRoot();
    } catch (error) {
      if (!isNotFound(error)) {
        if (error instanceof Error && error.message === 'IMPORT_HISTORY_INVALID') throw error;
        throw new Error('IMPORT_HISTORY_INVALID');
      }
      if (!create) throw error;
      try {
        await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
      } catch (mkdirError) {
        if (!isNotFound(mkdirError) && !(mkdirError instanceof Error && 'code' in mkdirError && mkdirError.code === 'EEXIST')) {
          throw new Error('IMPORT_HISTORY_INVALID');
        }
      }
      try {
        return await this.openExistingRoot();
      } catch {
        throw new Error('IMPORT_HISTORY_INVALID');
      }
    }
  }

  private async openExistingRoot(): Promise<FileHandle> {
    let root: FileHandle | undefined;
    try {
      root = await open(this.rootDirectory, rootFlags());
      const info = await root.stat();
      if (!info.isDirectory()) throw new Error('IMPORT_HISTORY_INVALID');
      await root.chmod(0o700);
      return root;
    } catch (error) {
      await root?.close();
      if (isNotFound(error)) throw error;
      throw new Error('IMPORT_HISTORY_INVALID');
    }
  }

  private async assertSameRoot(root: FileHandle): Promise<void> {
    const expected = await root.stat();
    const current = await this.openExistingRoot();
    try {
      const info = await current.stat();
      if (expected.dev !== info.dev || expected.ino !== info.ino) throw new Error('IMPORT_HISTORY_INVALID');
    } finally {
      await current.close();
    }
  }
}

function assertTaskId(taskId: string): void {
  if (!taskIdSchema.safeParse(taskId).success) throw new Error('IMPORT_TASK_ID_INVALID');
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function noFollowFlag(name: 'O_NOFOLLOW' | 'O_DIRECTORY'): number {
  const flag = constants[name];
  if (typeof flag !== 'number') throw new Error('IMPORT_HISTORY_INVALID');
  return flag;
}

function rootFlags(): number {
  return constants.O_RDONLY | noFollowFlag('O_DIRECTORY') | noFollowFlag('O_NOFOLLOW');
}

function readFlags(): number {
  return constants.O_RDONLY | noFollowFlag('O_NOFOLLOW');
}

function writeFlags(): number {
  return constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag('O_NOFOLLOW');
}
