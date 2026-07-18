import type { CanonicalNote } from '../../shared/domain';
import type {
  ImportAttachmentMetadata,
  ImportOutcome,
  MigrationProgress,
  ExportProgress
} from '../../shared/ipc';
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
    private readonly source: NotesProvider | null,
    private readonly target: NotesProvider,
    private readonly checkpoints: MigrationCheckpointStore
  ) {}

  async exportFromSource(): Promise<ExportBundle> {
    if (!this.source) throw new Error('SOURCE_PROVIDER_MISSING');
    return exportProviderNotes(this.source);
  }

  confirm(): void {
    this.confirmed = true;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async importToTarget(
    bundle: ExportBundle,
    observer?: (snapshot: MigrationProgress) => unknown
  ): Promise<MigrationReport> {
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
        await emitMigrationProgress(observer, bundle.notes.length, report, note, 'skipped');
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
        await emitMigrationProgress(observer, bundle.notes.length, report, note, 'created');
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
        await emitMigrationProgress(observer, bundle.notes.length, report, note, status, errorClass);
      }
    }

    return report;
  }
}

async function emitMigrationProgress(
  observer: ((snapshot: MigrationProgress) => unknown) | undefined,
  total: number,
  report: MigrationReport,
  note: CanonicalNote,
  outcome: ImportOutcome,
  errorCode?: string,
  attachment?: ImportAttachmentMetadata
): Promise<void> {
  await observer?.({
    total,
    completed: report.created + report.skipped + report.failed + report.manualReview,
    created: report.created,
    skipped: report.skipped,
    failed: report.failed,
    manualReview: report.manualReview,
    current: {
      sourceId: note.sourceId,
      title: note.title || '无标题',
      outcome,
      ...(errorCode ? { errorCode } : {}),
      ...(attachment ? { attachment } : {})
    },
    occurredAt: new Date().toISOString()
  });
}

export async function exportProviderNotes(
  source: NotesProvider,
  observer?: (progress: Omit<ExportProgress, 'source'>) => unknown
): Promise<ExportBundle> {
  const notes: CanonicalNote[] = [];
  let cursor: string | undefined;
  let total = 0;
  await observer?.({ total, completed: 0, stage: 'listing', current: null, occurredAt: new Date().toISOString() });

  do {
    const page = await source.listNotes(cursor);
    total += page.items.length;
    for (const summary of page.items) {
      try {
        const note = await source.getNote(summary.sourceId);
        const attachments = await Promise.all(
          note.attachments.map((attachment) => source.downloadAttachment(attachment))
        );
        notes.push({ ...note, attachments });
        await observer?.({ total, completed: notes.length, stage: 'exporting', current: { sourceId: note.sourceId, title: note.title || '无标题' }, occurredAt: new Date().toISOString() });
      } catch (error) {
        const errorCode = classifyMigrationError(error);
        await observer?.({ total, completed: notes.length, stage: 'failed', current: { sourceId: summary.sourceId, title: '无标题' }, errorCode, occurredAt: new Date().toISOString() });
        throw error;
      }
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  const bundle = {
    notes,
    warningCount: notes.reduce((count, note) => count + note.warnings.length, 0),
    attachmentCount: notes.reduce((count, note) => count + note.attachments.length, 0)
  };
  await observer?.({ total, completed: notes.length, stage: 'completed', current: null, occurredAt: new Date().toISOString() });
  return bundle;
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
