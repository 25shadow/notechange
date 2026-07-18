import { randomUUID } from 'node:crypto';
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
import { VivoApi } from './vivo-api';
import type { VivoCreateSyncRequest, VivoSyncNote, VivoSyncResource } from './vivo-sync-types';
import { normalizeContent } from '../../migration/content';

type VivoListedNote = {
  guid: string;
  noteBookGuid: string;
  title: string;
  contentDigest: string;
  createTime: number;
  updateTime: number;
  encryptType: number;
  resources: VivoListedResource[];
};

type VivoListedResource = {
  guid: string;
  resourceKey: string;
  fileID: string;
  domainAddr: string;
  name: string;
  mime: string;
  category: number;
};

export class VivoProvider implements NotesProvider {
  readonly id = 'vivo' as const;
  private readonly listedNotes = new Map<string, VivoListedNote>();

  constructor(
    private readonly api: VivoApi,
    private readonly attachmentDirectory = join(tmpdir(), 'notechange-vivo-attachments')
  ) {}

  async startLogin(): Promise<void> {
    throw new Error('LOGIN_SESSION_NOT_CONFIGURED:vivo');
  }

  async getLoginState(): Promise<LoginState> {
    try {
      await this.api.getSyncState(0);
      return { authenticated: true, accountLabel: null };
    } catch {
      return { authenticated: false, accountLabel: null };
    }
  }

  async listFolders(): Promise<Page<SourceFolder>> {
    throw new Error('VIVO_LIST_PAYLOAD_UNVERIFIED');
  }

  async listNotes(cursor?: string): Promise<Page<SourceNoteSummary>> {
    if (cursor) throw new Error('VIVO_CURSOR_UNSUPPORTED');
    const page = await this.api.listNotes();
    const notes = page.notes.filter((note) => note.deleted !== 0);
    for (const note of notes) this.listedNotes.set(note.guid, note);
    return {
      items: notes.map((note) => ({
        sourceId: note.guid,
        folderSourceId: note.noteBookGuid === '0' ? null : note.noteBookGuid
      })),
      nextCursor: null
    };
  }

  async getNote(sourceId: string): Promise<CanonicalNote> {
    const listed = this.listedNotes.get(sourceId);
    if (!listed) throw new Error('VIVO_NOTE_SUMMARY_MISSING');
    const response = await this.api.getNote(sourceId);
    const content = contentFromResponse(response);
    const title = listed.title || listed.contentDigest.split(/\r\n?|\n/, 1)[0] || '';
    const attachments = listed.resources
      .filter(isImageResource)
      .map(toSourceAttachment);
    const normalizedWithAttachmentPlaceholders = normalizeContent(
      replaceVivoImageReferences(content, attachments),
      { title, folderPath: listed.noteBookGuid }
    );
    const warnings = [...normalizedWithAttachmentPlaceholders.warnings];
    if (listed.encryptType === 1) {
      warnings.push({ code: 'encrypted-note', message: '加密笔记需要人工处理' });
    }
    if (listed.resources.some((resource) => !isImageResource(resource))) {
      warnings.push({ code: 'attachment-failed', message: '仅支持迁移图片附件，其他附件需要人工处理' });
    }
    return {
      sourceId,
      folderSourceId: listed.noteBookGuid === '0' ? null : listed.noteBookGuid,
      title,
      html: normalizedWithAttachmentPlaceholders.html,
      plainText: normalizedWithAttachmentPlaceholders.plainText,
      attachments: attachments.map((attachment) => ({
        ...attachment,
        sha256: '0'.repeat(64),
        localPath: ''
      })),
      createdAt: toIsoDate(listed.createTime),
      modifiedAt: toIsoDate(listed.updateTime),
      contentHash: normalizedWithAttachmentPlaceholders.contentHash,
      warnings
    };
  }

  async downloadAttachment(attachment: SourceAttachment): Promise<DownloadedAttachment> {
    const bytes = Buffer.from(await this.api.downloadAttachment(attachment));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const localName = createHash('sha256').update(attachment.sourceId).digest('hex');
    const localPath = join(this.attachmentDirectory, localName);
    await mkdir(this.attachmentDirectory, { recursive: true });
    await writeFile(localPath, bytes, { mode: 0o600 });
    return { ...attachment, localPath, sha256 };
  }

  async createFolder(_folder: SourceFolder): Promise<{ targetId: string }> {
    throw new Error('CONTRACT_WRITE_NOT_VERIFIED:createNotebook');
  }

  async upsertNote(
    note: CanonicalNote,
    targetFolderId: string | null
  ): Promise<TargetNote> {
    const syncState = await this.api.getSyncState(0);
    const guid = randomUUID();
    const createdAt = note.createdAt ? Date.parse(note.createdAt) : Date.now();
    const modifiedAt = note.modifiedAt ? Date.parse(note.modifiedAt) : createdAt;
    const resources = await Promise.all(
      note.attachments.map(async (attachment, index) => {
        const uploaded = await this.api.uploadAttachment(attachment);
        return toVivoResource(uploaded, attachment, guid, createdAt, index);
      })
    );
    const syncNote: VivoSyncNote = {
      guid,
      title: note.title,
      contentDigest: note.plainText.slice(0, 60),
      content: `${note.html}${resources.map(toVivoImageReference).join('')}`,
      conflictTime: null,
      createTime: createdAt,
      updateTime: modifiedAt,
      contentUpdateTime: modifiedAt,
      attrUpdateTime: modifiedAt,
      importantLevel: 0,
      noteBookGuid: targetFolderId ?? '0',
      tags: [],
      deleted: 1,
      dirty: 1,
      type: 1,
      contentLoaded: true,
      symbolCnf: '',
      paperTexture: '0',
      bgColor: 101,
      pageMargins: JSON.stringify([0, 16, 0, 16]),
      syncProtocolVersion: 0,
      isAiNote: 0,
      aiQuery: ''
    };
    const payload: VivoCreateSyncRequest = {
      type: 0,
      lastUpdateCount: syncState.updateCount,
      noteBooks: [],
      notes: [syncNote],
      tags: [],
      resources
    };
    const response = await this.api.createSync(payload);

    return {
      targetId: response.notes[0]?.guid ?? guid,
      modifiedAt: new Date(modifiedAt).toISOString()
    };
  }

  async dispose(): Promise<void> {
    await rm(this.attachmentDirectory, { recursive: true, force: true });
  }
}

function contentFromResponse(response: unknown): string {
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    const value = (response as { content?: unknown; data?: unknown }).content ??
      (response as { data?: unknown }).data;
    if (typeof value === 'string') return value;
  }
  throw new Error('VIVO_RESPONSE_INVALID:getNote');
}

function toIsoDate(value: number): string | null {
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
}

function toVivoResource(
  uploaded: { metaId: string; domain: string; fileSize: number },
  attachment: SourceAttachment,
  noteGuid: string,
  createdAt: number,
  index: number
): VivoSyncResource {
  return {
    guid: randomUUID(),
    name: attachment.filename,
    mime: extensionFromAttachment(attachment),
    resourceKey: uploaded.metaId,
    domainAddr: uploaded.domain,
    resourceSize: uploaded.fileSize,
    resType: 1,
    noteGuid,
    createTime: createdAt + index,
    updateTime: createdAt + index,
    fileID: uploaded.metaId,
    dirty: 1,
    deleted: 1,
    sort: index,
    category: 3
  };
}

function toVivoImageReference(resource: VivoSyncResource): string {
  return `<vnote-image guid="${resource.guid}" filename="${escapeAttribute(resource.name)}" updatetime="" type="" rinfo=""></vnote-image>`;
}

function extensionFromAttachment(attachment: SourceAttachment): string {
  const extension = attachment.filename.split('.').pop()?.toLowerCase();
  if (extension && /^[a-z0-9]{1,12}$/.test(extension)) return extension;
  return attachment.mimeType.split('/')[1] || 'bin';
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[character] ?? character);
}

function isImageResource(resource: VivoListedResource): boolean {
  return resource.category === 3 && Boolean(resource.guid) && Boolean(resource.resourceKey || resource.fileID);
}

function toSourceAttachment(resource: VivoListedResource): SourceAttachment {
  const filename = resource.name || `vivo-image.${resource.mime || 'jpg'}`;
  return {
    sourceId: resource.guid,
    filename,
    mimeType: toImageMimeType(resource.mime, filename),
    providerMetadata: {
      resourceKey: resource.resourceKey || resource.fileID,
      domain: resource.domainAddr
    }
  };
}

function toImageMimeType(mime: string, filename: string): string {
  if (mime.startsWith('image/')) return mime;
  const extension = (mime || filename.split('.').pop() || 'jpeg').toLowerCase();
  return extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`;
}

function replaceVivoImageReferences(content: string, attachments: SourceAttachment[]): string {
  const ids = new Set(attachments.map(({ sourceId }) => sourceId));
  return content.replace(/<vnote-image\b[^>]*\bguid=["']([^"']+)["'][^>]*>(?:<\/vnote-image>)?/gi, (tag, guid: string) =>
    ids.has(guid) ? `<img src="https://notechange.invalid/attachment/${encodeURIComponent(guid)}" alt="">` : tag
  );
}
