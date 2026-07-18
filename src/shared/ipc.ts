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

export type ImportOutcome = 'created' | 'skipped' | 'failed' | 'manual-review';

export type ImportAttachmentMetadata = {
  filename: string;
  mimeType: string;
};

export type ImportTaskStatus =
  | 'running'
  | 'completed'
  | 'completed-with-issues'
  | 'cancelled'
  | 'failed-to-start';

export type ImportProgress = {
  taskId: string;
  total: number;
  completed: number;
  created: number;
  skipped: number;
  failed: number;
  manualReview: number;
  current: {
    sourceId: string;
    title: string;
    outcome?: ImportOutcome;
    errorCode?: string;
    attachment?: ImportAttachmentMetadata;
  } | null;
  occurredAt: string;
};

export type MigrationProgress = Omit<ImportProgress, 'taskId'>;

export type ImportFailure = {
  sourceId: string;
  title: string;
  outcome: 'failed' | 'manual-review';
  errorCode: string;
  message: string;
  attachment?: ImportAttachmentMetadata;
  occurredAt: string;
};

export type ImportHistoryLog = {
  occurredAt: string;
  message: string;
  kind: 'info' | 'success' | 'error';
};

export type ImportHistoryTask = {
  schemaVersion: 1;
  taskId: string;
  batchId: string;
  source: 'xiaomi';
  target: 'vivo';
  status: ImportTaskStatus;
  startedAt: string;
  completedAt: string | null;
  progress: ImportProgress;
  logs: ImportHistoryLog[];
  failures: ImportFailure[];
};

export interface NoteChangeApi {
  getLoginState(provider: CloudProvider): Promise<RendererLoginState>;
  startLogin(provider: CloudProvider): Promise<RendererLoginState>;
  logout?(provider: CloudProvider): Promise<void>;
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
  openNoteCenter?(provider: CloudProvider): Promise<void>;
  listImportHistory?(): Promise<ImportHistoryTask[]>;
  getImportHistory?(taskId: string): Promise<ImportHistoryTask | null>;
  onImportProgress?(listener: (progress: ImportProgress) => void): () => void;
}

export const ipcChannels = {
  getLoginState: 'notechange:get-login-state',
  startLogin: 'notechange:start-login',
  logout: 'notechange:logout',
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
  cancelMigration: 'notechange:cancel-migration',
  openNoteCenter: 'notechange:open-note-center',
  listImportHistory: 'notechange:list-import-history',
  getImportHistory: 'notechange:get-import-history',
  importProgress: 'notechange:import-progress'
} as const;
