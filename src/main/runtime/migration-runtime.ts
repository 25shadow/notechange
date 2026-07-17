import type { Page } from 'playwright';

import type {
  CloudProvider,
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

export interface RuntimeSessionManager {
  getPage(provider: string): Page | null;
  open(provider: string, url: string, mode?: BrowserMode): Promise<Page>;
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
    if (restoredState.authenticated) return restoredState;

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
    return this.waitForAuthentication(
      provider,
      headlessPage,
      polling,
      sleep,
      `LOGIN_SESSION_LOST:${provider}`
    );
  }

  async getLoginState(provider: CloudProvider): Promise<RendererLoginState> {
    const page =
      this.options.sessionManager.getPage(provider) ??
      (await this.options.sessionManager.open(provider, providerUrls[provider], 'headless'));
    return this.options.createProvider(provider, page).getLoginState();
  }

  async scanXiaomi(): Promise<ScanSummary> {
    const sourcePage = this.requirePage('xiaomi');
    this.bundle = await exportProviderNotes(
      this.options.createProvider('xiaomi', sourcePage)
    );
    this.orchestrator = null;
    this.confirmed = false;
    return {
      noteCount: this.bundle.notes.length,
      attachmentCount: this.bundle.attachmentCount,
      warningCount: this.bundle.warningCount
    };
  }

  confirmMigration(): void {
    if (!this.bundle) throw new Error('EXPORT_BUNDLE_MISSING');
    this.confirmed = true;
  }

  async startImport(): Promise<RendererMigrationReport> {
    if (!this.bundle) throw new Error('EXPORT_BUNDLE_MISSING');
    if (!this.confirmed) throw new Error('MIGRATION_NOT_CONFIRMED');
    const sourcePage = this.requirePage('xiaomi');
    const targetPage = this.requirePage('vivo');
    this.orchestrator = new MigrationOrchestrator(
      this.options.createProvider('xiaomi', sourcePage),
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
    this.confirmed = false;
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
