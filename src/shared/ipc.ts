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

export type LocalExportSummary = ScanSummary & {
  batchId: string;
  exportedAt: string;
};

export type ExportPreviewFilter = 'all' | 'warnings' | 'attachments';

export type ExportPreviewQuery = {
  search: string;
  filter: ExportPreviewFilter;
  offset: number;
  limit: number;
};

export type ExportPreviewItem = {
  sourceId: string;
  title: string;
  excerpt: string;
  modifiedAt: string | null;
  attachmentCount: number;
  warningCount: number;
};

export type ExportPreviewPage = { total: number; items: ExportPreviewItem[] };

export type ExportPreviewDetail = {
  sourceId: string;
  folderSourceId: string | null;
  title: string;
  plainText: string;
  createdAt: string | null;
  modifiedAt: string | null;
  attachments: Array<{ sha256: string; filename: string; mimeType: string }>;
  warnings: Array<{ code: string; message: string }>;
};

export type ExportAttachmentData = { mimeType: string; base64: string };

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
  getLatestExportSummary(): Promise<LocalExportSummary | null>;
  getExportPreview(query: ExportPreviewQuery): Promise<ExportPreviewPage>;
  getExportPreviewDetail(sourceId: string): Promise<ExportPreviewDetail>;
  getExportAttachment(sourceId: string, sha256: string): Promise<ExportAttachmentData>;
  confirmMigration(): Promise<void>;
  startImport(): Promise<RendererMigrationReport>;
  cancelMigration(): Promise<void>;
}

export const ipcChannels = {
  getLoginState: 'notechange:get-login-state',
  startLogin: 'notechange:start-login',
  scanXiaomi: 'notechange:scan-xiaomi',
  getLatestExportSummary: 'notechange:get-latest-export-summary',
  getExportPreview: 'notechange:get-export-preview',
  getExportPreviewDetail: 'notechange:get-export-preview-detail',
  getExportAttachment: 'notechange:get-export-attachment',
  confirmMigration: 'notechange:confirm-migration',
  startImport: 'notechange:start-import',
  cancelMigration: 'notechange:cancel-migration'
} as const;
