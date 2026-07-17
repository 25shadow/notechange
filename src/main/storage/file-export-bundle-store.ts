import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

import { z } from 'zod';

import { canonicalNoteSchema, type CanonicalNote } from '../../shared/domain';
import type { ExportBundle } from '../migration/orchestrator';
import type { ExportBundleStore, StoredExportBundle } from './export-bundle-store';

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  batchId: z.string().min(1),
  exportedAt: z.string().datetime(),
  source: z.literal('xiaomi-cloud-notes'),
  noteCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative()
});

const notesSchema = z.object({
  schemaVersion: z.literal(1),
  notes: z.array(canonicalNoteSchema)
});

const latestSchema = z.object({ schemaVersion: z.literal(1), batchId: z.string().min(1) });

export class FileExportBundleStore implements ExportBundleStore {
  constructor(private readonly rootDirectory: string) {}

  async save(bundle: ExportBundle): Promise<StoredExportBundle> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const exportedAt = new Date().toISOString();
    const batchId = `${exportedAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
    const temporaryDirectory = join(this.rootDirectory, `${batchId}.tmp`);
    const batchDirectory = join(this.rootDirectory, batchId);
    const attachmentsDirectory = join(temporaryDirectory, 'attachments');

    try {
      await mkdir(attachmentsDirectory, { recursive: true, mode: 0o700 });
      const notes = await Promise.all(
        bundle.notes.map((note) => this.copyNoteAttachments(note, attachmentsDirectory))
      );
      const storedBundle: ExportBundle = { ...bundle, notes };
      const manifest = {
        schemaVersion: 1 as const,
        batchId,
        exportedAt,
        source: 'xiaomi-cloud-notes' as const,
        noteCount: notes.length,
        attachmentCount: bundle.attachmentCount,
        warningCount: bundle.warningCount
      };
      await writeJson(join(temporaryDirectory, 'manifest.json'), manifest);
      await writeJson(join(temporaryDirectory, 'notes.json'), {
        schemaVersion: 1,
        notes
      });
      await rename(temporaryDirectory, batchDirectory);
      await writeJsonAtomic(join(this.rootDirectory, 'latest.json'), {
        schemaVersion: 1,
        batchId
      });
      return { ...manifest, bundle: this.resolveBundlePaths(batchDirectory, storedBundle) };
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async loadLatest(): Promise<StoredExportBundle | null> {
    let latestRaw: string;
    try {
      latestRaw = await readFile(join(this.rootDirectory, 'latest.json'), 'utf8');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new Error('LOCAL_EXPORT_INVALID');
    }

    try {
      const latest = latestSchema.parse(JSON.parse(latestRaw));
      const stored = await this.load(latest.batchId);
      if (!stored) throw new Error('BATCH_MISSING');
      return stored;
    } catch {
      throw new Error('LOCAL_EXPORT_INVALID');
    }
  }

  async list(): Promise<StoredExportBundle[]> {
    let entries;
    try {
      entries = await readdir(this.rootDirectory, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw new Error('LOCAL_EXPORT_INVALID');
    }

    const stored = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.endsWith('.tmp'))
        .map(async (entry) => {
          try {
            return await this.load(entry.name);
          } catch {
            return null;
          }
        })
    );
    return stored
      .filter((entry): entry is StoredExportBundle => entry !== null)
      .sort((left, right) =>
        right.exportedAt.localeCompare(left.exportedAt) ||
        right.batchId.localeCompare(left.batchId)
      );
  }

  async load(batchId: string): Promise<StoredExportBundle | null> {
    assertBatchId(batchId);
    const batchDirectory = join(this.rootDirectory, batchId);
    try {
      const info = await lstat(batchDirectory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('BATCH_INVALID');
      const manifest = manifestSchema.parse(
        JSON.parse(await readFile(join(batchDirectory, 'manifest.json'), 'utf8'))
      );
      const notesFile = notesSchema.parse(
        JSON.parse(await readFile(join(batchDirectory, 'notes.json'), 'utf8'))
      );
      if (
        manifest.batchId !== batchId ||
        manifest.noteCount !== notesFile.notes.length ||
        manifest.attachmentCount !== notesFile.notes.reduce((sum, note) => sum + note.attachments.length, 0) ||
        manifest.warningCount !== notesFile.notes.reduce((sum, note) => sum + note.warnings.length, 0)
      ) {
        throw new Error('COUNT_MISMATCH');
      }
      const bundle: ExportBundle = {
        notes: notesFile.notes,
        attachmentCount: manifest.attachmentCount,
        warningCount: manifest.warningCount
      };
      const resolved = this.resolveBundlePaths(batchDirectory, bundle);
      await Promise.all(
        resolved.notes.flatMap((note) =>
          note.attachments.map(async (attachment) => {
            const info = await stat(attachment.localPath);
            if (!info.isFile()) throw new Error('ATTACHMENT_INVALID');
          })
        )
      );
      return { ...manifest, bundle: resolved };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new Error('LOCAL_EXPORT_INVALID');
    }
  }

  async delete(batchId: string): Promise<void> {
    assertBatchId(batchId);
    const batchDirectory = join(this.rootDirectory, batchId);
    try {
      const info = await lstat(batchDirectory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('EXPORT_BATCH_ID_INVALID');
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    await rm(batchDirectory, { recursive: true, force: true });
    const [latest] = await this.list();
    if (latest) {
      await writeJsonAtomic(join(this.rootDirectory, 'latest.json'), {
        schemaVersion: 1,
        batchId: latest.batchId
      });
    } else {
      await rm(join(this.rootDirectory, 'latest.json'), { force: true });
    }
  }

  async readAttachment(batchId: string, relativePath: string): Promise<Uint8Array> {
    assertBatchId(batchId);
    const batchDirectory = resolve(this.rootDirectory, batchId);
    const filePath = resolve(batchDirectory, relativePath);
    if (!filePath.startsWith(`${batchDirectory}${sep}`)) throw new Error('EXPORT_ATTACHMENT_MISSING');
    try {
      return await readFile(filePath);
    } catch {
      throw new Error('EXPORT_ATTACHMENT_MISSING');
    }
  }

  private async copyNoteAttachments(
    note: CanonicalNote,
    attachmentsDirectory: string
  ): Promise<CanonicalNote> {
    const attachments = await Promise.all(
      note.attachments.map(async (attachment) => {
        const extension = extensionFor(attachment.mimeType, attachment.filename);
        const filename = `${attachment.sha256}${extension}`;
        const destination = join(attachmentsDirectory, filename);
        try {
          await stat(destination);
        } catch {
          await copyFile(attachment.localPath, destination);
          await chmod(destination, 0o600);
        }
        return { ...attachment, localPath: join('attachments', filename) };
      })
    );
    return { ...note, attachments };
  }

  private resolveBundlePaths(batchDirectory: string, bundle: ExportBundle): ExportBundle {
    return {
      ...bundle,
      notes: bundle.notes.map((note) => ({
        ...note,
        attachments: note.attachments.map((attachment) => {
          const localPath = resolve(batchDirectory, attachment.localPath);
          if (!localPath.startsWith(`${resolve(batchDirectory)}${sep}`)) {
            throw new Error('LOCAL_EXPORT_INVALID');
          }
          return { ...attachment, localPath };
        })
      }))
    };
  }
}

function extensionFor(mimeType: string, filename: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/jpeg') return '.jpg';
  const extension = extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.bin';
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeJson(temporary, value);
  await rename(temporary, path);
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function assertBatchId(batchId: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(batchId) ||
    batchId === '.' ||
    batchId === '..'
  ) {
    throw new Error('EXPORT_BATCH_ID_INVALID');
  }
}
