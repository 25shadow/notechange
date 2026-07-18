import { randomUUID } from 'node:crypto';

import type { Page } from 'playwright';

import type {
  CloudProvider,
  ExportAttachmentData,
  ExportAttachmentRequest,
  ExportNoteRequest,
  ExportPreviewDetail,
  ExportPreviewPage,
  ExportPreviewQuery,
  ExportProgress,
  ImportFailure,
  ImportHistoryTask,
  ImportProgress,
  LocalExportSummary,
  RendererLoginState,
  RendererMigrationReport,
  ScanSummary
} from '../../shared/ipc';
import {
  exportProviderNotes,
  MigrationOrchestrator,
  type ExportBundle,
  type MigrationCheckpointStore
} from '../migration/orchestrator';
import type { NotesProvider } from '../providers/provider';
import type { BrowserMode } from '../browser/session-manager';
import type {
  ExportBundleStore,
  StoredExportBundle
} from '../storage/export-bundle-store';
import type { ImportHistoryStore, StoredImportTask } from '../storage/import-history-store';

export interface RuntimeSessionManager {
  getPage(provider: string): Page | null;
  open(provider: string, url: string, mode?: BrowserMode): Promise<Page>;
  persist(provider: string): Promise<void>;
  logout?(provider: string): Promise<void>;
  switchToHeaded(provider: string, url: string): Promise<Page>;
  switchToHeadless(provider: string, url: string): Promise<Page>;
  disposeAll(): Promise<void>;
}

export type RuntimeProviderFactory = (
  provider: CloudProvider,
  page: Page
) => NotesProvider;

export type MigrationRuntimeOptions = {
  sessionManager: RuntimeSessionManager;
  createProvider: RuntimeProviderFactory;
  checkpoints: MigrationCheckpointStore;
  exports: ExportBundleStore;
  importHistory?: ImportHistoryStore;
  loginPolling?: {
    intervalMs: number;
    timeoutMs: number;
    sleep?: (milliseconds: number) => Promise<void>;
  };
};

const providerUrls: Record<CloudProvider, string> = {
  xiaomi: 'https://i.mi.com/note/h5#/',
  vivo: 'https://pc.vivo.com.cn/suite?origin=cloudWeb#/note'
};

export class MigrationRuntime {
  private orchestrator: MigrationOrchestrator | null = null;
  private bundle: ExportBundle | null = null;
  private storedExport: StoredExportBundle | null = null;
  private confirmed = false;
  private readonly importHistory: ImportHistoryStore;

  constructor(private readonly options: MigrationRuntimeOptions) {
    this.importHistory = options.importHistory ?? new MemoryImportHistoryStore();
  }

  async startLogin(provider: CloudProvider): Promise<RendererLoginState> {
    const page =
      this.options.sessionManager.getPage(provider) ??
      (await this.options.sessionManager.open(provider, providerUrls[provider], 'headless'));
    const polling = this.options.loginPolling ?? {
      intervalMs: 750,
      timeoutMs: 5 * 60 * 1000
    };
    const sleep =
      polling.sleep ??
      ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const restoredState = await this.options.createProvider(provider, page).getLoginState();
    if (restoredState.authenticated) {
      await this.options.sessionManager.persist(provider);
      return restoredState;
    }

    const headedPage = await this.options.sessionManager.switchToHeaded(
      provider,
      providerUrls[provider]
    );
    await this.waitForAuthentication(
      provider,
      headedPage,
      polling,
      sleep,
      `LOGIN_TIMEOUT:${provider}`
    );

    const headlessPage = await this.options.sessionManager.switchToHeadless(
      provider,
      providerUrls[provider]
    );
    const authenticatedState = await this.waitForAuthentication(
      provider,
      headlessPage,
      polling,
      sleep,
      `LOGIN_SESSION_LOST:${provider}`
    );
    await this.options.sessionManager.persist(provider);
    return authenticatedState;
  }

  async getLoginState(provider: CloudProvider): Promise<RendererLoginState> {
    const page =
      this.options.sessionManager.getPage(provider) ??
      (await this.options.sessionManager.open(provider, providerUrls[provider], 'headless'));
    const polling = this.options.loginPolling ?? {
      intervalMs: 750,
      timeoutMs: 5 * 60 * 1000
    };
    const sleep =
      polling.sleep ??
      ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    let state: RendererLoginState = { authenticated: false, accountLabel: null };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      state = await this.options.createProvider(provider, page).getLoginState();
      if (state.authenticated) {
        await this.options.sessionManager.persist(provider);
        return state;
      }
      if (attempt < 9) await sleep(Math.min(polling.intervalMs, 500));
    }
    return state;
  }

  async logout(provider: CloudProvider): Promise<void> {
    await this.options.sessionManager.logout?.(provider);
  }

  async scanXiaomi(onProgress?: (progress: ExportProgress) => unknown): Promise<ScanSummary> {
    return this.scanProvider('xiaomi', onProgress);
  }

  async scanVivo(onProgress?: (progress: ExportProgress) => unknown): Promise<ScanSummary> {
    return this.scanProvider('vivo', onProgress);
  }

  private async scanProvider(source: CloudProvider, onProgress?: (progress: ExportProgress) => unknown): Promise<ScanSummary> {
    const sourcePage = this.requirePage(source);
    const exported = await exportProviderNotes(this.options.createProvider(source, sourcePage), (progress) => onProgress?.({ ...progress, source }));
    this.storedExport = await this.options.exports.save(exported, source);
    this.bundle = this.storedExport.bundle;
    this.orchestrator = null;
    this.confirmed = false;
    return {
      noteCount: this.bundle.notes.length,
      attachmentCount: this.bundle.attachmentCount,
      warningCount: this.bundle.warningCount
    };
  }

  async getLatestExportSummary(): Promise<LocalExportSummary | null> {
    const stored = await this.ensureStoredExport(false);
    return stored ? toLocalSummary(stored) : null;
  }

  async listExports(): Promise<LocalExportSummary[]> {
    return (await this.options.exports.list()).map(toLocalSummary);
  }

  async selectExport(batchId: string): Promise<LocalExportSummary> {
    const stored = await this.options.exports.load(batchId);
    if (!stored) throw new Error('EXPORT_BUNDLE_MISSING');
    this.storedExport = stored;
    this.bundle = stored.bundle;
    this.orchestrator = null;
    this.confirmed = false;
    return toLocalSummary(stored);
  }

  async deleteExport(batchId: string): Promise<void> {
    await this.options.exports.delete(batchId);
    if (this.storedExport?.batchId === batchId) {
      this.storedExport = null;
      this.bundle = null;
      this.orchestrator = null;
      this.confirmed = false;
    }
  }

  async getExportPreview(query: ExportPreviewQuery): Promise<ExportPreviewPage> {
    validatePreviewQuery(query);
    const stored = await this.loadStoredExport(query.batchId);
    const search = query.search.trim().toLocaleLowerCase();
    const filtered = stored.bundle.notes.filter((note) => {
      if (query.filter === 'warnings' && note.warnings.length === 0) return false;
      if (query.filter === 'attachments' && note.attachments.length === 0) return false;
      return !search || `${note.title}\n${note.plainText}`.toLocaleLowerCase().includes(search);
    });
    return {
      total: filtered.length,
      items: filtered.slice(query.offset, query.offset + query.limit).map((note) => ({
        sourceId: note.sourceId,
        title: note.title || '无标题',
        excerpt: note.plainText.replace(/\s+/g, ' ').trim().slice(0, 140),
        modifiedAt: note.modifiedAt,
        attachmentCount: note.attachments.length,
        warningCount: note.warnings.length
      }))
    };
  }

  async getExportPreviewDetail(request: ExportNoteRequest): Promise<ExportPreviewDetail> {
    const note = (await this.loadStoredExport(request.batchId)).bundle.notes.find(
      (candidate) => candidate.sourceId === request.sourceId
    );
    if (!note) throw new Error('EXPORT_NOTE_MISSING');
    return {
      sourceId: note.sourceId,
      folderSourceId: note.folderSourceId,
      title: note.title || '无标题',
      plainText: note.plainText,
      createdAt: note.createdAt,
      modifiedAt: note.modifiedAt,
      attachments: note.attachments.map(({ sourceId, sha256, filename, mimeType }) => ({
        sourceId,
        sha256,
        filename,
        mimeType
      })),
      warnings: note.warnings
    };
  }

  async getExportAttachment(
    request: ExportAttachmentRequest
  ): Promise<ExportAttachmentData> {
    const stored = await this.loadStoredExport(request.batchId);
    const note = stored.bundle.notes.find((candidate) => candidate.sourceId === request.sourceId);
    const attachment = note?.attachments.find((candidate) => candidate.sha256 === request.sha256);
    if (!attachment) throw new Error('EXPORT_ATTACHMENT_MISSING');
    const bytes = await this.options.exports.readAttachment(
      stored.batchId,
      attachment.localPath
    );
    return { mimeType: attachment.mimeType, base64: Buffer.from(bytes).toString('base64') };
  }

  confirmMigration(): void {
    if (!this.bundle) throw new Error('EXPORT_BUNDLE_MISSING');
    this.confirmed = true;
  }

  async startImport(
    onProgress?: (progress: ImportProgress) => void | Promise<void>
  ): Promise<RendererMigrationReport> {
    if (!this.bundle) throw new Error('EXPORT_BUNDLE_MISSING');
    if (!this.confirmed) throw new Error('MIGRATION_NOT_CONFIRMED');
    const stored = await this.ensureStoredExport(true);
    const source = stored.source ?? 'xiaomi';
    const target: CloudProvider = source === 'xiaomi' ? 'vivo' : 'xiaomi';
    const targetPage = this.requirePage(target);
    this.orchestrator = new MigrationOrchestrator(
      null,
      this.options.createProvider(target, targetPage),
      this.options.checkpoints
    );
    this.orchestrator.confirm();
    const taskId = randomUUID();
    const startedAt = new Date().toISOString();
    const initialProgress: ImportProgress = {
      taskId,
      total: this.bundle.notes.length,
      completed: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      manualReview: 0,
      current: null,
      occurredAt: startedAt
    };
    await this.importHistory.create({
      schemaVersion: 1,
      taskId,
      batchId: stored.batchId,
      source,
      target,
      status: 'running',
      startedAt,
      completedAt: null,
      progress: initialProgress,
      logs: [{ occurredAt: startedAt, message: '开始导入笔记', kind: 'info' }],
      failures: []
    });

    try {
      const report = await this.orchestrator.importToTarget(this.bundle, async (snapshot) => {
        const progress = { ...snapshot, taskId };
        const outcome = progress.current?.outcome;
        await this.importHistory.appendProgress(taskId, progress, {
          occurredAt: progress.occurredAt,
          message: formatProgressLog(progress),
          kind: outcome === 'failed' || outcome === 'manual-review' ? 'error' : 'success'
        });
        if (outcome === 'failed' || outcome === 'manual-review') {
          await this.importHistory.appendFailure(taskId, toImportFailure(progress));
        }
        await onProgress?.(progress);
      });
      const completedAt = new Date().toISOString();
      const status = report.cancelled
        ? 'cancelled'
        : report.failed > 0 || report.manualReview > 0
          ? 'completed-with-issues'
          : 'completed';
      await this.importHistory.complete(taskId, status, completedAt);
      return report;
    } catch (error) {
      await this.importHistory.complete(taskId, 'failed-to-start', new Date().toISOString());
      throw error;
    }
  }

  async listImportHistory(): Promise<ImportHistoryTask[]> {
    return this.importHistory.list();
  }

  async getImportHistory(taskId: string): Promise<ImportHistoryTask | null> {
    return this.importHistory.get(taskId);
  }

  async openNoteCenter(provider: CloudProvider): Promise<void> {
    const url = providerUrls[provider];
    if (this.options.sessionManager.getPage(provider)) {
      await this.options.sessionManager.switchToHeaded(provider, url);
      return;
    }
    await this.options.sessionManager.open(provider, url, 'headed');
  }

  cancelMigration(): void {
    this.orchestrator?.cancel();
  }

  async dispose(): Promise<void> {
    await this.options.sessionManager.disposeAll();
    this.orchestrator = null;
    this.bundle = null;
    this.storedExport = null;
    this.confirmed = false;
  }

  private async ensureStoredExport(required: true): Promise<StoredExportBundle>;
  private async ensureStoredExport(required: false): Promise<StoredExportBundle | null>;
  private async ensureStoredExport(required: boolean): Promise<StoredExportBundle | null> {
    if (!this.storedExport) {
      this.storedExport = await this.options.exports.loadLatest();
      this.bundle = this.storedExport?.bundle ?? null;
    }
    if (required && !this.storedExport) throw new Error('EXPORT_BUNDLE_MISSING');
    return this.storedExport;
  }

  private async loadStoredExport(batchId: string): Promise<StoredExportBundle> {
    const stored = await this.options.exports.load(batchId);
    if (!stored) throw new Error('EXPORT_BUNDLE_MISSING');
    return stored;
  }

  private requirePage(provider: CloudProvider): Page {
    const page = this.options.sessionManager.getPage(provider);
    if (!page) throw new Error(`LOGIN_SESSION_MISSING:${provider}`);
    return page;
  }

  private async waitForAuthentication(
    provider: CloudProvider,
    page: Page,
    polling: { intervalMs: number; timeoutMs: number },
    sleep: (milliseconds: number) => Promise<void>,
    timeoutError: string
  ): Promise<RendererLoginState> {
    const deadline = Date.now() + polling.timeoutMs;
    while (true) {
      const state = await this.options.createProvider(provider, page).getLoginState();
      if (state.authenticated) return state;
      if (Date.now() >= deadline) throw new Error(timeoutError);
      await sleep(polling.intervalMs);
    }
  }
}

function formatProgressLog(progress: ImportProgress): string {
  const current = progress.current;
  if (!current?.outcome) return '导入进度已更新';
  const labels = {
    created: '已导入',
    skipped: '已跳过',
    failed: '导入失败',
    'manual-review': '需要人工处理'
  } as const;
  return `${labels[current.outcome]}：${current.title}`;
}

function toImportFailure(progress: ImportProgress): ImportFailure {
  const current = progress.current;
  if (!current || (current.outcome !== 'failed' && current.outcome !== 'manual-review')) {
    throw new Error('IMPORT_PROGRESS_INVALID');
  }
  return {
    sourceId: current.sourceId,
    title: current.title,
    outcome: current.outcome,
    errorCode: current.errorCode ?? 'UNKNOWN',
    message: current.errorCode ?? 'UNKNOWN',
    attachment: current.attachment,
    occurredAt: progress.occurredAt
  };
}

class MemoryImportHistoryStore implements ImportHistoryStore {
  private readonly tasks = new Map<string, StoredImportTask>();

  async create(task: StoredImportTask): Promise<void> {
    this.tasks.set(task.taskId, task);
  }

  async appendProgress(taskId: string, progress: ImportProgress): Promise<void> {
    const task = this.require(taskId);
    this.tasks.set(taskId, { ...task, progress });
  }

  async appendFailure(taskId: string, failure: ImportFailure): Promise<void> {
    const task = this.require(taskId);
    this.tasks.set(taskId, { ...task, failures: [...task.failures, failure] });
  }

  async complete(taskId: string, status: StoredImportTask['status'], completedAt: string): Promise<void> {
    const task = this.require(taskId);
    this.tasks.set(taskId, { ...task, status, completedAt });
  }

  async list(): Promise<StoredImportTask[]> {
    return [...this.tasks.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async get(taskId: string): Promise<StoredImportTask | null> {
    return this.tasks.get(taskId) ?? null;
  }

  private require(taskId: string): StoredImportTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('IMPORT_HISTORY_MISSING');
    return task;
  }
}

function toLocalSummary(stored: StoredExportBundle): LocalExportSummary {
  return {
    batchId: stored.batchId,
    exportedAt: stored.exportedAt,
    source: stored.source,
    noteCount: stored.noteCount,
    attachmentCount: stored.attachmentCount,
    warningCount: stored.warningCount
  };
}

function validatePreviewQuery(query: ExportPreviewQuery): void {
  if (!Number.isInteger(query.offset) || query.offset < 0) throw new Error('PREVIEW_QUERY_INVALID');
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
    throw new Error('PREVIEW_QUERY_INVALID');
  }
  if (!['all', 'warnings', 'attachments'].includes(query.filter)) {
    throw new Error('PREVIEW_QUERY_INVALID');
  }
}
