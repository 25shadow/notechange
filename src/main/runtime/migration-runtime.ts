import type { Page } from 'playwright';

import type {
  CloudProvider,
  ExportAttachmentData,
  ExportPreviewDetail,
  ExportPreviewPage,
  ExportPreviewQuery,
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

export interface RuntimeSessionManager {
  getPage(provider: string): Page | null;
  open(provider: string, url: string, mode?: BrowserMode): Promise<Page>;
  persist(provider: string): Promise<void>;
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

  constructor(private readonly options: MigrationRuntimeOptions) {}

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

  async scanXiaomi(): Promise<ScanSummary> {
    const sourcePage = this.requirePage('xiaomi');
    const exported = await exportProviderNotes(
      this.options.createProvider('xiaomi', sourcePage)
    );
    this.storedExport = await this.options.exports.save(exported);
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

  async getExportPreview(query: ExportPreviewQuery): Promise<ExportPreviewPage> {
    const stored = await this.ensureStoredExport(true);
    validatePreviewQuery(query);
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

  async getExportPreviewDetail(sourceId: string): Promise<ExportPreviewDetail> {
    const note = (await this.ensureStoredExport(true)).bundle.notes.find(
      (candidate) => candidate.sourceId === sourceId
    );
    if (!note) throw new Error('EXPORT_NOTE_MISSING');
    return {
      sourceId: note.sourceId,
      folderSourceId: note.folderSourceId,
      title: note.title || '无标题',
      plainText: note.plainText,
      createdAt: note.createdAt,
      modifiedAt: note.modifiedAt,
      attachments: note.attachments.map(({ sha256, filename, mimeType }) => ({
        sha256,
        filename,
        mimeType
      })),
      warnings: note.warnings
    };
  }

  async getExportAttachment(
    sourceId: string,
    sha256: string
  ): Promise<ExportAttachmentData> {
    const stored = await this.ensureStoredExport(true);
    const note = stored.bundle.notes.find((candidate) => candidate.sourceId === sourceId);
    const attachment = note?.attachments.find((candidate) => candidate.sha256 === sha256);
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

  async startImport(): Promise<RendererMigrationReport> {
    if (!this.bundle) throw new Error('EXPORT_BUNDLE_MISSING');
    if (!this.confirmed) throw new Error('MIGRATION_NOT_CONFIRMED');
    const targetPage = this.requirePage('vivo');
    this.orchestrator = new MigrationOrchestrator(
      null,
      this.options.createProvider('vivo', targetPage),
      this.options.checkpoints
    );
    this.orchestrator.confirm();
    return this.orchestrator.importToTarget(this.bundle);
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

function toLocalSummary(stored: StoredExportBundle): LocalExportSummary {
  return {
    batchId: stored.batchId,
    exportedAt: stored.exportedAt,
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
