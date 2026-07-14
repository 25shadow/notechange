import { describe, expect, it } from 'vitest';

import type { CanonicalNote, Page } from '../../src/shared/domain';
import { MigrationOrchestrator } from '../../src/main/migration/orchestrator';
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

function note(id: string): CanonicalNote {
  return {
    sourceId: id,
    folderSourceId: null,
    title: `合成标题-${id}`,
    html: `<p>合成正文-${id}</p>`,
    plainText: `合成正文-${id}`,
    attachments: [],
    createdAt: null,
    modifiedAt: null,
    contentHash: id.padEnd(64, 'a').slice(0, 64),
    warnings: []
  };
}

class MemorySource implements NotesProvider {
  readonly id = 'xiaomi' as const;
  constructor(private readonly notes: CanonicalNote[]) {}
  async listNotes(): Promise<Page<SourceNoteSummary>> {
    return {
      items: this.notes.map(({ sourceId, folderSourceId }) => ({ sourceId, folderSourceId })),
      nextCursor: null
    };
  }
  async getNote(sourceId: string) {
    const found = this.notes.find((candidate) => candidate.sourceId === sourceId);
    if (!found) throw new Error('NOT_FOUND');
    return found;
  }
  async downloadAttachment(attachment: SourceAttachment): Promise<DownloadedAttachment> {
    return { ...attachment, localPath: '/synthetic', sha256: 'a'.repeat(64) };
  }
  async startLogin() {}
  async getLoginState(): Promise<LoginState> {
    return { authenticated: true, accountLabel: null };
  }
  async listFolders(): Promise<Page<SourceFolder>> {
    return { items: [], nextCursor: null };
  }
  async createFolder(_folder: SourceFolder): Promise<{ targetId: string }> {
    throw new Error('SOURCE_WRITE_FORBIDDEN');
  }
  async upsertNote(
    _note: CanonicalNote,
    _targetFolderId: string | null
  ): Promise<TargetNote> {
    throw new Error('SOURCE_WRITE_FORBIDDEN');
  }
  async dispose() {}
}

class MemoryTarget extends MemorySource {
  readonly writes: string[] = [];
  failOnceFor: string | null = null;
  private failed = false;

  constructor() {
    super([]);
  }

  override async upsertNote(
    input: CanonicalNote,
    _targetFolderId: string | null
  ): Promise<TargetNote> {
    if (input.sourceId === this.failOnceFor && !this.failed) {
      this.failed = true;
      throw new Error('FORMAT_INVALID');
    }
    this.writes.push(input.sourceId);
    return { targetId: `target-${input.sourceId}`, modifiedAt: null };
  }
}

class MemoryCheckpointStore implements MigrationCheckpointStore {
  readonly values = new Map<string, MigrationCheckpoint>();
  async get(sourceId: string) {
    return this.values.get(sourceId) ?? null;
  }
  async save(checkpoint: MigrationCheckpoint) {
    this.values.set(checkpoint.sourceId, checkpoint);
  }
}

describe('MigrationOrchestrator', () => {
  it('先导出预览，明确确认后才导入 vivo', async () => {
    const source = new MemorySource([note('note-1'), note('note-2')]);
    const target = new MemoryTarget();
    const orchestrator = new MigrationOrchestrator(source, target, new MemoryCheckpointStore());

    const bundle = await orchestrator.exportFromSource();

    expect(bundle.notes).toHaveLength(2);
    expect(target.writes).toEqual([]);
    await expect(orchestrator.importToTarget(bundle)).rejects.toThrow(
      'MIGRATION_NOT_CONFIRMED'
    );

    orchestrator.confirm();
    const report = await orchestrator.importToTarget(bundle);
    expect(target.writes).toEqual(['note-1', 'note-2']);
    expect(report.created).toBe(2);
  });

  it('重复导入跳过已创建项，失败项可以恢复', async () => {
    const source = new MemorySource([note('note-1'), note('note-2')]);
    const target = new MemoryTarget();
    target.failOnceFor = 'note-2';
    const checkpoints = new MemoryCheckpointStore();
    const orchestrator = new MigrationOrchestrator(source, target, checkpoints);
    const bundle = await orchestrator.exportFromSource();
    orchestrator.confirm();

    const first = await orchestrator.importToTarget(bundle);
    const resumed = await orchestrator.importToTarget(bundle);

    expect(first).toMatchObject({ created: 1, failed: 1 });
    expect(resumed).toMatchObject({ created: 1, skipped: 1 });
    expect(target.writes).toEqual(['note-1', 'note-2']);
  });
});
