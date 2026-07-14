import { z } from 'zod';

export const providerSchema = z.enum(['xiaomi', 'vivo']);
export type ProviderId = z.infer<typeof providerSchema>;

export const migrationWarningSchema = z.object({
  code: z.enum(['unsupported-content', 'encrypted-note', 'attachment-failed']),
  message: z.string()
});

export const canonicalAttachmentSchema = z.object({
  sourceId: z.string(),
  mimeType: z.string(),
  filename: z.string(),
  sha256: z.string().length(64),
  localPath: z.string()
});

export const canonicalNoteSchema = z.object({
  sourceId: z.string(),
  folderSourceId: z.string().nullable(),
  title: z.string(),
  html: z.string(),
  plainText: z.string(),
  attachments: z.array(canonicalAttachmentSchema),
  createdAt: z.string().datetime().nullable(),
  modifiedAt: z.string().datetime().nullable(),
  contentHash: z.string().length(64),
  warnings: z.array(migrationWarningSchema)
});

export type CanonicalNote = z.infer<typeof canonicalNoteSchema>;
export type Page<T> = { items: T[]; nextCursor: string | null };
