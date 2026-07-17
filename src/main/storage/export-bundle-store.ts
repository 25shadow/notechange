import type { ExportBundle } from '../migration/orchestrator';

export type StoredExportBundle = {
  batchId: string;
  exportedAt: string;
  noteCount: number;
  attachmentCount: number;
  warningCount: number;
  bundle: ExportBundle;
};

export interface ExportBundleStore {
  save(bundle: ExportBundle): Promise<StoredExportBundle>;
  loadLatest(): Promise<StoredExportBundle | null>;
  readAttachment(batchId: string, relativePath: string): Promise<Uint8Array>;
}
