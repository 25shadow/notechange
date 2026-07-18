import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileImportHistoryStore, type StoredImportTask } from '../../src/main/storage/import-history-store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FileImportHistoryStore', () => {
  it('writes updates atomically and reloads history newest first', async () => {
    const root = await temporaryRoot();
    const store = new FileImportHistoryStore(root);
    await store.create(fixtureTask('task-old', '2026-07-18T10:00:00.000Z'));
    await store.create(fixtureTask('task-new', '2026-07-18T11:00:00.000Z'));
    await store.appendProgress('task-new', fixtureProgress('task-new', 1));
    await store.complete('task-new', 'completed', '2026-07-18T11:10:00.000Z');

    expect((await store.list()).map((task) => task.taskId)).toEqual(['task-new', 'task-old']);
    expect((await new FileImportHistoryStore(root).get('task-new'))).toMatchObject({
      status: 'completed',
      completedAt: '2026-07-18T11:10:00.000Z',
      progress: { completed: 1 }
    });
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, 'task-new.json'))).mode & 0o777).toBe(0o600);
  });

  it('skips a corrupt task file while listing valid history', async () => {
    const root = await temporaryRoot();
    const store = new FileImportHistoryStore(root);
    await store.create(fixtureTask('valid', '2026-07-18T10:00:00.000Z'));
    await writeFile(join(root, 'corrupt.json'), '{invalid', { encoding: 'utf8', mode: 0o600 });

    expect((await store.list()).map((task) => task.taskId)).toEqual(['valid']);
    await expect(access(join(root, 'corrupt.json'))).resolves.toBeUndefined();
  });

  it('persists only validated failure fields without note content', async () => {
    const root = await temporaryRoot();
    const store = new FileImportHistoryStore(root);
    await store.create(fixtureTask('task-1', '2026-07-18T10:00:00.000Z'));
    await store.appendFailure('task-1', {
      sourceId: 'source-1',
      title: 'A safe title',
      outcome: 'failed',
      errorCode: 'NETWORK_TRANSIENT',
      message: 'Network request failed',
      occurredAt: '2026-07-18T10:01:00.000Z',
      content: '<p>private note content</p>'
    } as never);

    expect((await store.get('task-1'))?.failures).toEqual([
      {
        sourceId: 'source-1',
        title: 'A safe title',
        outcome: 'failed',
        errorCode: 'NETWORK_TRANSIENT',
        message: 'Network request failed',
        occurredAt: '2026-07-18T10:01:00.000Z'
      }
    ]);
    expect(await readFile(join(root, 'task-1.json'), 'utf8')).not.toContain('private note content');
  });

  it('persists attachment omission metadata without attachment data', async () => {
    const root = await temporaryRoot();
    const store = new FileImportHistoryStore(root);
    await store.create(fixtureTask('task-1', '2026-07-18T10:00:00.000Z'));
    await store.appendFailure('task-1', {
      sourceId: 'source-1',
      title: 'A safe title',
      outcome: 'manual-review',
      errorCode: 'VIVO_ATTACHMENT_UPLOAD_UNVERIFIED',
      message: 'VIVO_ATTACHMENT_UPLOAD_UNVERIFIED',
      attachment: {
        filename: 'fixture.png',
        mimeType: 'image/png',
        base64: 'private attachment data'
      },
      occurredAt: '2026-07-18T10:01:00.000Z',
      base64: 'private attachment data'
    } as never);

    expect((await store.get('task-1'))?.failures).toEqual([expect.objectContaining({
      attachment: { filename: 'fixture.png', mimeType: 'image/png' }
    })]);
    expect(await readFile(join(root, 'task-1.json'), 'utf8')).not.toContain('private attachment data');
  });

  it('serializes concurrent updates to the same task', async () => {
    const root = await temporaryRoot();
    const store = new FileImportHistoryStore(root);
    await store.create(fixtureTask('task-1', '2026-07-18T10:00:00.000Z'));

    await Promise.all([
      store.appendProgress('task-1', fixtureProgress('task-1', 1)),
      store.appendFailure('task-1', fixtureFailure('source-1')),
      store.complete('task-1', 'completed-with-issues', '2026-07-18T10:01:00.000Z')
    ]);

    expect(await store.get('task-1')).toMatchObject({
      status: 'completed-with-issues',
      completedAt: '2026-07-18T10:01:00.000Z',
      progress: { completed: 1 },
      failures: [fixtureFailure('source-1')]
    });
  });

  it('rejects symlink roots and task files without following their targets', async () => {
    const parent = await temporaryRoot();
    const actualRoot = join(parent, 'actual');
    const linkedRoot = join(parent, 'linked');
    await mkdir(actualRoot, { mode: 0o700 });
    await symlink(actualRoot, linkedRoot);

    await expect(new FileImportHistoryStore(linkedRoot).create(fixtureTask('task-1', '2026-07-18T10:00:00.000Z')))
      .rejects.toThrow('IMPORT_HISTORY_INVALID');
    await expect(new FileImportHistoryStore(linkedRoot).get('task-1')).rejects.toThrow(
      'IMPORT_HISTORY_INVALID'
    );
    await expect(access(join(actualRoot, 'task-1.json'))).rejects.toMatchObject({ code: 'ENOENT' });

    const store = new FileImportHistoryStore(actualRoot);
    await store.create(fixtureTask('task-1', '2026-07-18T10:00:00.000Z'));
    const replacement = join(parent, 'replacement.json');
    await writeFile(replacement, JSON.stringify(fixtureTask('replacement', '2026-07-18T10:00:00.000Z')));
    await unlink(join(actualRoot, 'task-1.json'));
    await symlink(replacement, join(actualRoot, 'task-1.json'));

    await expect(store.get('task-1')).rejects.toThrow('IMPORT_HISTORY_INVALID');
    expect(await store.list()).toEqual([]);
  });

  it('rejects persisted tasks with inconsistent counters or timestamps', async () => {
    const root = await temporaryRoot();
    const invalidCounters = fixtureTask('bad-counters', '2026-07-18T10:00:00.000Z');
    invalidCounters.progress = { ...fixtureProgress('bad-counters', 1), created: 0 };
    const invalidTimestamp = fixtureTask('bad-timestamp', '2026-07-18T10:00:00.000Z');
    invalidTimestamp.completedAt = '2026-07-18T10:01:00.000Z';
    await writeFile(join(root, 'bad-counters.json'), JSON.stringify(invalidCounters));
    await writeFile(join(root, 'bad-timestamp.json'), JSON.stringify(invalidTimestamp));

    expect(await new FileImportHistoryStore(root).list()).toEqual([]);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'notechange-import-history-'));
  roots.push(root);
  return root;
}

function fixtureTask(taskId: string, startedAt: string): StoredImportTask {
  return {
    schemaVersion: 1,
    taskId,
    batchId: 'batch-1',
    source: 'xiaomi',
    target: 'vivo',
    status: 'running',
    startedAt,
    completedAt: null,
    progress: fixtureProgress(taskId, 0),
    logs: [],
    failures: []
  };
}

function fixtureProgress(taskId: string, completed: number) {
  return {
    taskId,
    total: 2,
    completed,
    created: completed,
    skipped: 0,
    failed: 0,
    manualReview: 0,
    current: completed
      ? { sourceId: 'source-1', title: 'A safe title', outcome: 'created' as const }
      : null,
    occurredAt: '2026-07-18T10:00:00.000Z'
  };
}

function fixtureFailure(sourceId: string) {
  return {
    sourceId,
    title: 'A safe title',
    outcome: 'failed' as const,
    errorCode: 'NETWORK_TRANSIENT',
    message: 'Network request failed',
    occurredAt: '2026-07-18T10:01:00.000Z'
  };
}
