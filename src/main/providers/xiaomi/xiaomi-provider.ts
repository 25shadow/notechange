import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CanonicalNote, Page } from '../../../shared/domain';
import type {
  DownloadedAttachment,
  LoginState,
  NotesProvider,
  SourceAttachment,
  SourceFolder,
  SourceNoteSummary,
  TargetNote
} from '../provider';
import { XiaomiApi } from './xiaomi-api';
import { mapXiaomiNote } from './xiaomi-mapper';

export class XiaomiProvider implements NotesProvider {
  readonly id = 'xiaomi' as const;

  constructor(
    private readonly api: XiaomiApi,
    private readonly attachmentDirectory = join(tmpdir(), 'notechange-xiaomi-attachments')
  ) {}

  async startLogin(): Promise<void> {
    throw new Error('LOGIN_SESSION_NOT_CONFIGURED:xiaomi');
  }

  async getLoginState(): Promise<LoginState> {
    try {
      await this.api.hasData();
      return { authenticated: true, accountLabel: null };
    } catch {
      return { authenticated: false, accountLabel: null };
    }
  }

  async listFolders(cursor?: string): Promise<Page<SourceFolder>> {
    const page = await this.api.listNotes(cursor);
    if (page.folders.length > 0) throw new Error('XIAOMI_FOLDER_SHAPE_UNVERIFIED');
    return { items: [], nextCursor: page.lastPage ? null : page.syncTag };
  }

  async listNotes(cursor?: string): Promise<Page<SourceNoteSummary>> {
    const page = await this.api.listNotes(cursor);
    return {
      items: page.entries.map((entry) => ({
        sourceId: entry.id,
        folderSourceId:
          entry.folderId == null || String(entry.folderId) === '0'
            ? null
            : String(entry.folderId)
      })),
      nextCursor: page.lastPage ? null : page.syncTag
    };
  }

  async getNote(sourceId: string): Promise<CanonicalNote> {
    const { entry } = await this.api.getNote(sourceId);
    return mapXiaomiNote(entry);
  }

  async downloadAttachment(attachment: SourceAttachment): Promise<DownloadedAttachment> {
    const bytes = Buffer.from(await this.api.downloadImage(attachment.sourceId));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const localName = createHash('sha256').update(attachment.sourceId).digest('hex');
    const localPath = join(this.attachmentDirectory, localName);
    await mkdir(this.attachmentDirectory, { recursive: true });
    await writeFile(localPath, bytes, { mode: 0o600 });
    return {
      ...attachment,
      localPath,
      sha256
    };
  }

  async createFolder(folder: SourceFolder): Promise<{ targetId: string }> {
    const result = await this.api.createFolder(JSON.stringify({ name: folder.name }));
    return { targetId: result.entry.id };
  }

  async upsertNote(
    note: CanonicalNote,
    targetFolderId: string | null
  ): Promise<TargetNote> {
    if (note.warnings.some(({ code }) => code === 'encrypted-note')) {
      throw new Error('ENCRYPTED_NOTE');
    }
    const uploadedAttachments = await Promise.all(note.attachments.map((attachment) => this.api.uploadImage(attachment)));
    const now = Date.now();
    const result = await this.api.createNote(
      JSON.stringify({
        content: withUploadedImages(note.html, note.attachments, uploadedAttachments),
        setting: { data: uploadedAttachments },
        colorId: 0,
        folderId: targetFolderId ?? '0',
        alertDate: 0,
        createDate: note.createdAt ? Date.parse(note.createdAt) : now,
        modifyDate: note.modifiedAt ? Date.parse(note.modifiedAt) : now,
        extraInfo: JSON.stringify({
          title: note.title,
          note_content_type: 'common'
        })
      })
    );
    return {
      targetId: result.entry.id,
      modifiedAt: result.entry.modifyDate
        ? new Date(result.entry.modifyDate).toISOString()
        : note.modifiedAt
    };
  }

  async dispose(): Promise<void> {
    await rm(this.attachmentDirectory, { recursive: true, force: true });
  }
}

function withUploadedImages(
  html: string,
  attachments: CanonicalNote['attachments'],
  uploaded: Array<{ fileId: string; digest: string; mimeType: string }>
): string {
  const bySourceId = new Map(
    attachments.map((attachment, index) => [attachment.sourceId, uploaded[index]!])
  );
  const replaced = html.replace(/<img\b[^>]*\bsrc=["']https:\/\/notechange\.invalid\/attachment\/([^"']+)["'][^>]*>/gi, (_tag, encodedId: string) => {
    const image = bySourceId.get(decodeURIComponent(encodedId));
    return image ? xiaomiImageNode(image.fileId) : _tag;
  });
  const referenced = new Set([...replaced.matchAll(/data-fileid=["']([^"']+)["']/gi)].map((match) => match[1]));
  return `${replaced}${uploaded.filter(({ fileId }) => !referenced.has(fileId)).map(({ fileId }) => xiaomiImageNode(fileId)).join('')}`;
}

function xiaomiImageNode(fileId: string): string {
  return `<div data-fileid="${escapeHtmlAttribute(fileId)}" data-size="0" data-desc="" custom-img="true"></div>`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[character] ?? character);
}
