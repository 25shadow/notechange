export type CloudProvider = 'xiaomi' | 'vivo';

export type RendererLoginState = {
  authenticated: boolean;
  accountLabel: string | null;
};

export type ScanSummary = {
  noteCount: number;
  attachmentCount: number;
  warningCount: number;
};

export type RendererMigrationReport = {
  created: number;
  skipped: number;
  failed: number;
  manualReview: number;
  cancelled: boolean;
};

export interface NoteChangeApi {
  getLoginState(provider: CloudProvider): Promise<RendererLoginState>;
  startLogin(provider: CloudProvider): Promise<RendererLoginState>;
  scanXiaomi(): Promise<ScanSummary>;
  confirmMigration(): Promise<void>;
  startImport(): Promise<RendererMigrationReport>;
  cancelMigration(): Promise<void>;
}

export const ipcChannels = {
  getLoginState: 'notechange:get-login-state',
  startLogin: 'notechange:start-login',
  scanXiaomi: 'notechange:scan-xiaomi',
  confirmMigration: 'notechange:confirm-migration',
  startImport: 'notechange:start-import',
  cancelMigration: 'notechange:cancel-migration'
} as const;
