import type { Page } from 'playwright';

import type {
  CloudProvider,
  RendererLoginState,
  RendererMigrationReport,
  ScanSummary
} from '../../shared/ipc';
import {
  MigrationOrchestrator,
  type ExportBundle,
  type MigrationCheckpointStore
} from '../migration/orchestrator';
import type { NotesProvider } from '../providers/provider';

export interface RuntimeSessionManager {
  getPage(provider: string): Page | null;
  open(provider: string, url: string): Promise<Page>;
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
};

const providerUrls: Record<CloudProvider, string> = {
  xiaomi: 'https://i.mi.com/note/h5#/',
  vivo: 'https://pc.vivo.com.cn/suite?origin=cloudWeb#/note'
};

export class MigrationRuntime {
  private orchestrator: MigrationOrchestrator | null = null;
  private bundle: ExportBundle | null = null;

  constructor(private readonly options: MigrationRuntimeOptions) {}

  async startLogin(provider: CloudProvider): Promise<RendererLoginState> {
    const page =
      this.options.sessionManager.getPage(provider) ??
      (await this.options.sessionManager.open(provider, providerUrls[provider]));
    return this.options.createProvider(provider, page).getLoginState();
  }

  async getLoginState(provider: CloudProvider): Promise<RendererLoginState> {
    const page = this.options.sessionManager.getPage(provider);
    if (!page) return { authenticated: false, accountLabel: null };
    return this.options.createProvider(provider, page).getLoginState();
  }

  async scanXiaomi(): Promise<ScanSummary> {
    const sourcePage = this.requirePage('xiaomi');
    const targetPage = this.requirePage('vivo');
    this.orchestrator = new MigrationOrchestrator(
      this.options.createProvider('xiaomi', sourcePage),
      this.options.createProvider('vivo', targetPage),
      this.options.checkpoints
    );
    this.bundle = await this.orchestrator.exportFromSource();
    return {
      noteCount: this.bundle.notes.length,
      attachmentCount: this.bundle.attachmentCount,
      warningCount: this.bundle.warningCount
    };
  }

  confirmMigration(): void {
    if (!this.orchestrator || !this.bundle) throw new Error('EXPORT_BUNDLE_MISSING');
    this.orchestrator.confirm();
  }

  async startImport(): Promise<RendererMigrationReport> {
    if (!this.orchestrator || !this.bundle) throw new Error('EXPORT_BUNDLE_MISSING');
    return this.orchestrator.importToTarget(this.bundle);
  }

  cancelMigration(): void {
    this.orchestrator?.cancel();
  }

  async dispose(): Promise<void> {
    await this.options.sessionManager.disposeAll();
    this.orchestrator = null;
    this.bundle = null;
  }

  private requirePage(provider: CloudProvider): Page {
    const page = this.options.sessionManager.getPage(provider);
    if (!page) throw new Error(`LOGIN_SESSION_MISSING:${provider}`);
    return page;
  }
}
