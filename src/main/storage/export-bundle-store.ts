import type { ExportBundle } from '../migration/orchestrator';
import type { ProviderId } from '../../shared/domain';

export type StoredExportBundle = {
  batchId: string;
  exportedAt: string;
  noteCount: number;
  attachmentCount: number;
  warningCount: number;
  source?: ProviderId;
  bundle: ExportBundle;
};

export interface ExportBundleStore {
  save(bundle: ExportBundle, source?: ProviderId): Promise<StoredExportBundle>;
  list(): Promise<StoredExportBundle[]>;
  load(batchId: string): Promise<StoredExportBundle | null>;
  loadLatest(): Promise<StoredExportBundle | null>;
  delete(batchId: string): Promise<void>;
  readAttachment(batchId: string, relativePath: string): Promise<Uint8Array>;
}
