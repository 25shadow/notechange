import { describe, expect, it, vi } from 'vitest';

import type { Page } from 'playwright';
import type { CanonicalNote, Page as DomainPage } from '../../src/shared/domain';
import { MigrationRuntime } from '../../src/main/runtime/migration-runtime';
import type {
  MigrationCheckpoint,
  MigrationCheckpointStore
} from '../../src/main/migration/orchestrator';
import type { ExportBundle } from '../../src/main/migration/orchestrator';
import type {
  ExportBundleStore,
  StoredExportBundle
} from '../../src/main/storage/export-bundle-store';
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

class MemoryExports implements ExportBundleStore {
  values: StoredExportBundle[] = [];
  saves = 0;

  async save(bundle: ExportBundle): Promise<StoredExportBundle> {
    this.saves += 1;
    const value = {
      batchId: `batch-${this.saves}`,
      exportedAt: `2026-07-17T00:00:0${this.saves}.000Z`,
      noteCount: bundle.notes.length,
      attachmentCount: bundle.attachmentCount,
      warningCount: bundle.warningCount,
      bundle
    };
    this.values.unshift(value);
    return value;
  }

  async list() {
    return [...this.values];
  }

  async load(batchId: string) {
    return this.values.find((value) => value.batchId === batchId) ?? null;
  }

  async loadLatest() {
    return this.values[0] ?? null;
  }

  async delete(batchId: string) {
    this.values = this.values.filter((value) => value.batchId !== batchId);
  }

  async readAttachment() {
    return new Uint8Array([1, 2, 3]);
  }
}

describe('MigrationRuntime', () => {
  it('复用登录页，并在确认前只导出不写入 vivo', async () => {
    const page = {} as Page;
    const sessionManager = {
      getPage: vi.fn(() => null as Page | null),
      open: vi.fn(async () => page),
      persist: vi.fn(async () => undefined),
      switchToHeaded: vi.fn(async () => page),
      switchToHeadless: vi.fn(async () => page),
      disposeAll: vi.fn(async () => undefined)
    };
    const xiaomi = new FakeProvider('xiaomi');
    const vivo = new FakeProvider('vivo');
    const runtime = new MigrationRuntime({
      sessionManager,
      createProvider: (provider) => (provider === 'xiaomi' ? xiaomi : vivo),
      checkpoints: new MemoryCheckpoints()
      , exports: new MemoryExports()
    });

    await runtime.startLogin('xiaomi');
    sessionManager.getPage.mockReturnValue(page);
    await runtime.startLogin('xiaomi');
    expect(sessionManager.open).toHaveBeenCalledTimes(1);
    expect(sessionManager.persist).toHaveBeenCalledWith('xiaomi');
    expect(sessionManager.open).toHaveBeenCalledWith(
      'xiaomi',
      'https://i.mi.com/note/h5#/',
      'headless'
    );

    const summary = await runtime.scanXiaomi();
    expect(summary).toEqual({ noteCount: 1, attachmentCount: 0, warningCount: 0 });
    expect(vivo.writes).toEqual([]);
    await expect(runtime.startImport()).rejects.toThrow('MIGRATION_NOT_CONFIRMED');

    runtime.confirmMigration();
    await runtime.startImport();
    expect(vivo.writes).toEqual(['synthetic-1']);
  });

  it('持续检测登录成功并把可见会话切换为无头会话', async () => {
    const visiblePage = { id: 'visible' } as unknown as Page;
    const headlessPage = { id: 'headless' } as unknown as Page;
    const states = [false, false, true, false, true];
    const provider = new FakeProvider('xiaomi');
    provider.getLoginState = vi.fn(async () => ({
      authenticated: states.shift() ?? true,
      accountLabel: null
    }));
    const sessionManager = {
      getPage: vi.fn(() => null as Page | null),
      open: vi.fn(async () => visiblePage),
      persist: vi.fn(async () => undefined),
      switchToHeaded: vi.fn(async () => visiblePage),
      switchToHeadless: vi.fn(async () => headlessPage),
      disposeAll: vi.fn(async () => undefined)
    };
    const runtime = new MigrationRuntime({
      sessionManager,
      createProvider: () => provider,
      checkpoints: new MemoryCheckpoints(),
      exports: new MemoryExports(),
      loginPolling: { intervalMs: 0, timeoutMs: 100, sleep: async () => undefined }
    });

    await expect(runtime.startLogin('xiaomi')).resolves.toMatchObject({
      authenticated: true
    });
    expect(provider.getLoginState).toHaveBeenCalledTimes(5);
    expect(sessionManager.switchToHeaded).toHaveBeenCalledWith(
      'xiaomi',
      'https://i.mi.com/note/h5#/'
    );
    expect(sessionManager.switchToHeadless).toHaveBeenCalledWith(
      'xiaomi',
      'https://i.mi.com/note/h5#/'
    );
  });

  it('只登录小米即可导出，导入时才要求 vivo 登录', async () => {
    const xiaomiPage = { id: 'xiaomi' } as unknown as Page;
    const vivoPage = { id: 'vivo' } as unknown as Page;
    let vivoConnected = false;
    const sessionManager = {
      getPage: vi.fn((provider: string) => {
        if (provider === 'xiaomi') return xiaomiPage;
        return vivoConnected ? vivoPage : null;
      }),
      open: vi.fn(),
      persist: vi.fn(async () => undefined),
      switchToHeaded: vi.fn(),
      switchToHeadless: vi.fn(),
      disposeAll: vi.fn(async () => undefined)
    };
    const xiaomi = new FakeProvider('xiaomi');
    const vivo = new FakeProvider('vivo');
    const runtime = new MigrationRuntime({
      sessionManager,
      createProvider: (provider) => (provider === 'xiaomi' ? xiaomi : vivo),
      checkpoints: new MemoryCheckpoints(),
      exports: new MemoryExports()
    });

    await expect(runtime.scanXiaomi()).resolves.toMatchObject({ noteCount: 1 });
    runtime.confirmMigration();
    await expect(runtime.startImport()).rejects.toThrow('LOGIN_SESSION_MISSING:vivo');

    vivoConnected = true;
    await expect(runtime.startImport()).resolves.toMatchObject({ created: 1 });
  });

  it('查询登录状态时从固定 profile 无头恢复已有会话', async () => {
    const headlessPage = { id: 'headless' } as unknown as Page;
    const sessionManager = {
      getPage: vi.fn(() => null as Page | null),
      open: vi.fn(async () => headlessPage),
      persist: vi.fn(async () => undefined),
      switchToHeaded: vi.fn(),
      switchToHeadless: vi.fn(),
      disposeAll: vi.fn(async () => undefined)
    };
    const runtime = new MigrationRuntime({
      sessionManager,
      createProvider: () => new FakeProvider('vivo'),
      checkpoints: new MemoryCheckpoints(),
      exports: new MemoryExports()
    });

    await expect(runtime.getLoginState('vivo')).resolves.toMatchObject({
      authenticated: true
    });
    expect(sessionManager.open).toHaveBeenCalledWith(
      'vivo',
      'https://pc.vivo.com.cn/suite?origin=cloudWeb#/note',
      'headless'
    );
    expect(sessionManager.switchToHeaded).not.toHaveBeenCalled();
    expect(sessionManager.persist).toHaveBeenCalledWith('vivo');
  });

  it('启动检测会等待页面认证初始化完成', async () => {
    const headlessPage = { id: 'headless' } as unknown as Page;
    const states = [false, false, true];
    const provider = new FakeProvider('xiaomi');
    provider.getLoginState = vi.fn(async () => ({
      authenticated: states.shift() ?? true,
      accountLabel: null
    }));
    const sessionManager = {
      getPage: vi.fn(() => null as Page | null),
      open: vi.fn(async () => headlessPage),
      persist: vi.fn(async () => undefined),
      switchToHeaded: vi.fn(),
      switchToHeadless: vi.fn(),
      disposeAll: vi.fn(async () => undefined)
    };
    const runtime = new MigrationRuntime({
      sessionManager,
      createProvider: () => provider,
      checkpoints: new MemoryCheckpoints(),
      exports: new MemoryExports(),
      loginPolling: { intervalMs: 0, timeoutMs: 100, sleep: async () => undefined }
    });

    await expect(runtime.getLoginState('xiaomi')).resolves.toMatchObject({
      authenticated: true
    });
    expect(provider.getLoginState).toHaveBeenCalledTimes(3);
    expect(sessionManager.persist).toHaveBeenCalledWith('xiaomi');
  });

  it('保存新导出并从本地批次恢复搜索预览和详情', async () => {
    const page = {} as Page;
    const exports = new MemoryExports();
    const sessionManager = {
      getPage: vi.fn(() => page),
      open: vi.fn(async () => page),
      persist: vi.fn(async () => undefined),
      switchToHeaded: vi.fn(async () => page),
      switchToHeadless: vi.fn(async () => page),
      disposeAll: vi.fn(async () => undefined)
    };
    const runtime = new MigrationRuntime({
      sessionManager,
      createProvider: () => new FakeProvider('xiaomi'),
      checkpoints: new MemoryCheckpoints(),
      exports
    });

    await runtime.scanXiaomi();
    expect(exports.saves).toBe(1);

    const restored = new MigrationRuntime({
      sessionManager: { ...sessionManager, getPage: vi.fn(() => null) },
      createProvider: () => new FakeProvider('xiaomi'),
      checkpoints: new MemoryCheckpoints(),
      exports
    });
    await expect(restored.getLatestExportSummary()).resolves.toMatchObject({
      batchId: 'batch-1',
      noteCount: 1
    });
    await expect(
      restored.getExportPreview({ batchId: 'batch-1', search: '合成正文', filter: 'all', offset: 0, limit: 50 })
    ).resolves.toMatchObject({ total: 1, items: [{ sourceId: 'synthetic-1' }] });
    await expect(restored.getExportPreviewDetail({ batchId: 'batch-1', sourceId: 'synthetic-1' })).resolves.toMatchObject({
      title: '合成标题',
      plainText: '合成正文',
      attachments: []
    });
  });

  it('预览详情暴露附件 sourceId 但不暴露本地路径', async () => {
    const exports = new MemoryExports();
    await exports.save({
      notes: [{
        ...canonicalNote,
        attachments: [{
          sourceId: 'file-a',
          mimeType: 'image/jpeg',
          filename: 'a.jpg',
          sha256: 'b'.repeat(64),
          localPath: '/private/a.jpg'
        }]
      }],
      attachmentCount: 1,
      warningCount: 0
    });
    const runtime = new MigrationRuntime({
      sessionManager: {
        getPage: vi.fn(() => null),
        open: vi.fn(),
        persist: vi.fn(),
        switchToHeaded: vi.fn(),
        switchToHeadless: vi.fn(),
        disposeAll: vi.fn(async () => undefined)
      },
      createProvider: () => new FakeProvider('xiaomi'),
      checkpoints: new MemoryCheckpoints(),
      exports
    });

    const detail = await runtime.getExportPreviewDetail({
      batchId: 'batch-1',
      sourceId: 'synthetic-1'
    });

    expect(detail.attachments).toEqual([{
      sourceId: 'file-a',
      mimeType: 'image/jpeg',
      filename: 'a.jpg',
      sha256: 'b'.repeat(64)
    }]);
    expect(detail.attachments[0]).not.toHaveProperty('localPath');
  });

  it('从本地恢复的批次导入 vivo 时不要求小米在线', async () => {
    const vivoPage = {} as Page;
    const vivo = new FakeProvider('vivo');
    const exports = new MemoryExports();
    await exports.save({ notes: [canonicalNote], attachmentCount: 0, warningCount: 0 });
    const sessionManager = {
      getPage: vi.fn((provider: string) => provider === 'vivo' ? vivoPage : null),
      open: vi.fn(),
      persist: vi.fn(),
      switchToHeaded: vi.fn(),
      switchToHeadless: vi.fn(),
      disposeAll: vi.fn(async () => undefined)
    };
    const runtime = new MigrationRuntime({
      sessionManager,
      createProvider: (provider) => {
        if (provider === 'xiaomi') throw new Error('XIAOMI_MUST_NOT_BE_CREATED');
        return vivo;
      },
      checkpoints: new MemoryCheckpoints(),
      exports
    });

    await runtime.getLatestExportSummary();
    runtime.confirmMigration();
    await expect(runtime.startImport()).resolves.toMatchObject({ created: 1 });
  });

  it('列出并选择指定批次，删除当前批次后清空迁移状态', async () => {
    const exports = new MemoryExports();
    await exports.save({ notes: [canonicalNote], attachmentCount: 0, warningCount: 0 });
    await exports.save({
      notes: [{ ...canonicalNote, sourceId: 'synthetic-2', title: '第二批标题' }],
      attachmentCount: 0,
      warningCount: 0
    });
    const runtime = new MigrationRuntime({
      sessionManager: {
        getPage: vi.fn(() => null),
        open: vi.fn(),
        persist: vi.fn(),
        switchToHeaded: vi.fn(),
        switchToHeadless: vi.fn(),
        disposeAll: vi.fn()
      },
      createProvider: () => new FakeProvider('xiaomi'),
      checkpoints: new MemoryCheckpoints(),
      exports
    });

    await expect(runtime.listExports()).resolves.toEqual([
      expect.objectContaining({ batchId: 'batch-2' }),
      expect.objectContaining({ batchId: 'batch-1' })
    ]);
    await runtime.selectExport('batch-1');
    await expect(
      runtime.getExportPreview({
        batchId: 'batch-1',
        search: '',
        filter: 'all',
        offset: 0,
        limit: 50
      })
    ).resolves.toMatchObject({ total: 1, items: [{ sourceId: 'synthetic-1' }] });

    await runtime.deleteExport('batch-1');
    expect(() => runtime.confirmMigration()).toThrow('EXPORT_BUNDLE_MISSING');
    await expect(runtime.listExports()).resolves.toHaveLength(1);
  });

  it('删除非当前批次不影响已选择批次', async () => {
    const exports = new MemoryExports();
    await exports.save({ notes: [canonicalNote], attachmentCount: 0, warningCount: 0 });
    await exports.save({ notes: [canonicalNote], attachmentCount: 0, warningCount: 0 });
    const runtime = new MigrationRuntime({
      sessionManager: {
        getPage: vi.fn(() => null),
        open: vi.fn(),
        persist: vi.fn(),
        switchToHeaded: vi.fn(),
        switchToHeadless: vi.fn(),
        disposeAll: vi.fn()
      },
      createProvider: () => new FakeProvider('xiaomi'),
      checkpoints: new MemoryCheckpoints(),
      exports
    });

    await runtime.selectExport('batch-2');
    await runtime.deleteExport('batch-1');
    expect(() => runtime.confirmMigration()).not.toThrow();
  });
});
