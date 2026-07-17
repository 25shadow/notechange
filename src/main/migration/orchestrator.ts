import type { CanonicalNote } from '../../shared/domain';
import type { NotesProvider } from '../providers/provider';
import { retryTransient } from './retry';

export type MigrationCheckpointStatus =
  | 'running'
  | 'created'
  | 'skipped'
  | 'failed'
  | 'manual-review';

export type MigrationCheckpoint = {
  sourceId: string;
  contentHash: string;
  status: MigrationCheckpointStatus;
  targetId?: string;
  errorClass?: string;
};

export interface MigrationCheckpointStore {
  get(sourceId: string): Promise<MigrationCheckpoint | null>;
  save(checkpoint: MigrationCheckpoint): Promise<void>;
}

export type ExportBundle = {
  notes: CanonicalNote[];
  warningCount: number;
  attachmentCount: number;
};

export type MigrationReport = {
  created: number;
  skipped: number;
  failed: number;
  manualReview: number;
  cancelled: boolean;
};

export class MigrationOrchestrator {
  private confirmed = false;
  private cancelled = false;

  constructor(
    private readonly source: NotesProvider,
    private readonly target: NotesProvider,
    private readonly checkpoints: MigrationCheckpointStore
  ) {}

  async exportFromSource(): Promise<ExportBundle> {
    return exportProviderNotes(this.source);
  }

  confirm(): void {
    this.confirmed = true;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async importToTarget(bundle: ExportBundle): Promise<MigrationReport> {
    if (!this.confirmed) throw new Error('MIGRATION_NOT_CONFIRMED');
    const report: MigrationReport = {
      created: 0,
      skipped: 0,
      failed: 0,
      manualReview: 0,
      cancelled: false
    };

    for (const note of bundle.notes) {
      if (this.cancelled) {
        report.cancelled = true;
        break;
      }

      const previous = await this.checkpoints.get(note.sourceId);
      if (previous?.status === 'created' && previous.contentHash === note.contentHash) {
        report.skipped += 1;
        continue;
      }

      await this.checkpoints.save({
        sourceId: note.sourceId,
        contentHash: note.contentHash,
        status: 'running'
      });

      try {
        const created = await retryTransient(() =>
          this.target.upsertNote(note, note.folderSourceId)
        );
        await this.checkpoints.save({
          sourceId: note.sourceId,
          contentHash: note.contentHash,
          status: 'created',
          targetId: created.targetId
        });
        report.created += 1;
      } catch (error) {
        const errorClass = classifyMigrationError(error);
        const status = errorClass === 'ENCRYPTED_NOTE' ? 'manual-review' : 'failed';
        await this.checkpoints.save({
          sourceId: note.sourceId,
          contentHash: note.contentHash,
          status,
          errorClass
        });
        if (status === 'manual-review') report.manualReview += 1;
        else report.failed += 1;
      }
    }

    return report;
  }
}

export async function exportProviderNotes(source: NotesProvider): Promise<ExportBundle> {
  const notes: CanonicalNote[] = [];
  let cursor: string | undefined;

  do {
    const page = await source.listNotes(cursor);
    for (const summary of page.items) {
      const note = await source.getNote(summary.sourceId);
      const attachments = await Promise.all(
        note.attachments.map((attachment) => source.downloadAttachment(attachment))
      );
      notes.push({ ...note, attachments });
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return {
    notes,
    warningCount: notes.reduce((count, note) => count + note.warnings.length, 0),
    attachmentCount: notes.reduce((count, note) => count + note.attachments.length, 0)
  };
}

function classifyMigrationError(error: unknown): string {
  const value = error instanceof Error ? error.message : 'UNKNOWN';
  const allowed = new Set([
    'AUTH_EXPIRED',
    'CAPTCHA_REQUIRED',
    'CONTRACT_WRITE_NOT_VERIFIED:createSync',
    'ENCRYPTED_NOTE',
    'FORMAT_INVALID',
    'NETWORK_TRANSIENT',
    'RATE_LIMITED',
    'VIVO_ATTACHMENTS_UNSUPPORTED'
  ]);
  return allowed.has(value) ? value : 'UNKNOWN';
}
