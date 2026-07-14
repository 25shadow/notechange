import { describe, expect, it, vi } from 'vitest';

import type { Page } from 'playwright';
import type { CanonicalNote, Page as DomainPage } from '../../src/shared/domain';
import { MigrationRuntime } from '../../src/main/runtime/migration-runtime';
import type {
  MigrationCheckpoint,
  MigrationCheckpointStore
} from '../../src/main/migration/orchestrator';
import type {
  DownloadedAttachment,
  LoginState,
  NotesProvider,
  SourceAttachment,
  SourceFolder,
  SourceNoteSummary,
  TargetNote
} from '../../src/main/providers/provider';

const canonicalNote: CanonicalNote = {
  sourceId: 'synthetic-1',
  folderSourceId: null,
  title: '合成标题',
  html: '<p>合成正文</p>',
  plainText: '合成正文',
  attachments: [],
  createdAt: null,
  modifiedAt: null,
  contentHash: 'a'.repeat(64),
  warnings: []
};

class FakeProvider implements NotesProvider {
  readonly id;
  readonly writes: string[] = [];

  constructor(id: 'xiaomi' | 'vivo') {
    this.id = id;
  }

  async startLogin() {}
  async getLoginState(): Promise<LoginState> {
    return { authenticated: true, accountLabel: null };
  }
  async listFolders(): Promise<DomainPage<SourceFolder>> {
    return { items: [], nextCursor: null };
  }
  async listNotes(): Promise<DomainPage<SourceNoteSummary>> {
    return this.id === 'xiaomi'
      ? { items: [{ sourceId: canonicalNote.sourceId, folderSourceId: null }], nextCursor: null }
      : { items: [], nextCursor: null };
  }
  async getNote() {
    return canonicalNote;
  }
  async downloadAttachment(attachment: SourceAttachment): Promise<DownloadedAttachment> {
    return { ...attachment, localPath: '/synthetic', sha256: 'b'.repeat(64) };
  }
  async createFolder(): Promise<{ targetId: string }> {
    return { targetId: 'folder-1' };
  }
  async upsertNote(note: CanonicalNote): Promise<TargetNote> {
    this.writes.push(note.sourceId);
    return { targetId: 'target-1', modifiedAt: null };
  }
  async dispose() {}
}

class MemoryCheckpoints implements MigrationCheckpointStore {
  private readonly values = new Map<string, MigrationCheckpoint>();
  async get(sourceId: string) {
    return this.values.get(sourceId) ?? null;
  }
  async save(checkpoint: MigrationCheckpoint) {
    this.values.set(checkpoint.sourceId, checkpoint);
  }
}

describe('MigrationRuntime', () => {
  it('复用登录页，并在确认前只导出不写入 vivo', async () => {
    const page = {} as Page;
    const sessionManager = {
      getPage: vi.fn(() => null as Page | null),
      open: vi.fn(async () => page),
      disposeAll: vi.fn(async () => undefined)
    };
    const xiaomi = new FakeProvider('xiaomi');
    const vivo = new FakeProvider('vivo');
    const runtime = new MigrationRuntime({
      sessionManager,
      createProvider: (provider) => (provider === 'xiaomi' ? xiaomi : vivo),
      checkpoints: new MemoryCheckpoints()
    });

    await runtime.startLogin('xiaomi');
    sessionManager.getPage.mockReturnValue(page);
    await runtime.startLogin('xiaomi');
    expect(sessionManager.open).toHaveBeenCalledTimes(1);

    const summary = await runtime.scanXiaomi();
    expect(summary).toEqual({ noteCount: 1, attachmentCount: 0, warningCount: 0 });
    expect(vivo.writes).toEqual([]);
    await expect(runtime.startImport()).rejects.toThrow('MIGRATION_NOT_CONFIRMED');

    runtime.confirmMigration();
    await runtime.startImport();
    expect(vivo.writes).toEqual(['synthetic-1']);
  });
});
