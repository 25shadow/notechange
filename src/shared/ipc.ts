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
  batchId: string;
  search: string;
  filter: ExportPreviewFilter;
  offset: number;
  limit: number;
};

export type ExportNoteRequest = { batchId: string; sourceId: string };
export type ExportAttachmentRequest = ExportNoteRequest & { sha256: string };

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
  attachments: Array<{
    sourceId: string;
    sha256: string;
    filename: string;
    mimeType: string;
  }>;
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
  listExports(): Promise<LocalExportSummary[]>;
  selectExport(batchId: string): Promise<LocalExportSummary>;
  deleteExport(batchId: string): Promise<void>;
  getExportPreview(query: ExportPreviewQuery): Promise<ExportPreviewPage>;
  getExportPreviewDetail(request: ExportNoteRequest): Promise<ExportPreviewDetail>;
  getExportAttachment(request: ExportAttachmentRequest): Promise<ExportAttachmentData>;
  confirmMigration(): Promise<void>;
  startImport(): Promise<RendererMigrationReport>;
  cancelMigration(): Promise<void>;
}

export const ipcChannels = {
  getLoginState: 'notechange:get-login-state',
  startLogin: 'notechange:start-login',
  scanXiaomi: 'notechange:scan-xiaomi',
  getLatestExportSummary: 'notechange:get-latest-export-summary',
  listExports: 'notechange:list-exports',
  selectExport: 'notechange:select-export',
  deleteExport: 'notechange:delete-export',
  getExportPreview: 'notechange:get-export-preview',
  getExportPreviewDetail: 'notechange:get-export-preview-detail',
  getExportAttachment: 'notechange:get-export-attachment',
  confirmMigration: 'notechange:confirm-migration',
  startImport: 'notechange:start-import',
  cancelMigration: 'notechange:cancel-migration'
} as const;
