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
  list(): Promise<StoredExportBundle[]>;
  load(batchId: string): Promise<StoredExportBundle | null>;
  loadLatest(): Promise<StoredExportBundle | null>;
  delete(batchId: string): Promise<void>;
  readAttachment(batchId: string, relativePath: string): Promise<Uint8Array>;
}
