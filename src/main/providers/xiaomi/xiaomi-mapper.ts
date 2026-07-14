import type { CanonicalNote } from '../../../shared/domain';
import { normalizeContent } from '../../migration/content';
import type { XiaomiNoteEntry } from './xiaomi-api';

export function mapXiaomiNote(entry: XiaomiNoteEntry): CanonicalNote {
  const attachmentHashes = entry.setting.data.map(({ digest }) => digest);
  const normalized = normalizeContent(entry.content, {
    title: entry.subject,
    attachmentSha256: attachmentHashes,
    folderPath: String(entry.folderId)
  });
  const warnings = [...normalized.warnings];

  if (entry.encryptInfo) {
    warnings.push({ code: 'encrypted-note', message: '加密笔记需要人工处理' });
  }

  return {
    sourceId: entry.id,
    folderSourceId: entry.folderId === 0 ? null : String(entry.folderId),
    title: entry.subject,
    html: normalized.html,
    plainText: normalized.plainText,
    attachments: entry.setting.data.map((attachment) => ({
      sourceId: attachment.fileId,
      mimeType: attachment.mimeType,
      filename: imageFilename(attachment.mimeType),
      sha256: /^[a-f0-9]{64}$/i.test(attachment.digest)
        ? attachment.digest.toLowerCase()
        : '0'.repeat(64),
      localPath: ''
    })),
    createdAt: new Date(entry.createDate).toISOString(),
    modifiedAt: new Date(entry.modifyDate).toISOString(),
    contentHash: normalized.contentHash,
    warnings
  };
}

function imageFilename(mimeType: string): string {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `note-image.${extension}`;
}
