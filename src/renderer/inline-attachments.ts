import type { ExportPreviewDetail } from '../shared/ipc';

type PreviewAttachment = ExportPreviewDetail['attachments'][number];

export type InlineSegment =
  | { type: 'text'; value: string }
  | { type: 'attachment'; attachment: PreviewAttachment };

export function splitInlineAttachments(
  plainText: string,
  attachments: PreviewAttachment[]
): { segments: InlineSegment[]; unreferenced: PreviewAttachment[] } {
  const bySourceId = new Map(attachments.map((attachment) => [attachment.sourceId, attachment]));
  const used = new Set<string>();
  const segments: InlineSegment[] = [];
  const placeholder = /☺\s+([0-9A-Za-z._-]+)(?:<[^\r\n]*\/>)?/g;
  let textStart = 0;

  for (const match of plainText.matchAll(placeholder)) {
    const sourceId = match[1];
    const attachment = sourceId ? bySourceId.get(sourceId) : undefined;
    if (!attachment || used.has(sourceId)) continue;
    const matchIndex = match.index ?? 0;
    const text = plainText.slice(textStart, matchIndex);
    if (text) segments.push({ type: 'text', value: text });
    segments.push({ type: 'attachment', attachment });
    used.add(sourceId);
    textStart = matchIndex + match[0].length;
  }

  const trailingText = plainText.slice(textStart);
  if (trailingText || segments.length === 0) segments.push({ type: 'text', value: trailingText });

  return {
    segments,
    unreferenced: attachments.filter((attachment) => !used.has(attachment.sourceId))
  };
}
