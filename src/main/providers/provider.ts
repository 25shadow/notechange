import type { CanonicalNote, Page, ProviderId } from '../../shared/domain';

export type LoginState = {
  authenticated: boolean;
  accountLabel: string | null;
};

export type SourceFolder = {
  sourceId: string;
  parentSourceId: string | null;
  name: string;
};

export type SourceNoteSummary = {
  sourceId: string;
  folderSourceId: string | null;
};

export type SourceAttachment = {
  sourceId: string;
  mimeType: string;
  filename: string;
};

export type DownloadedAttachment = SourceAttachment & {
  localPath: string;
  sha256: string;
};

export type TargetNote = {
  targetId: string;
  modifiedAt: string | null;
};

export interface NotesProvider {
  readonly id: ProviderId;
  startLogin(): Promise<void>;
  getLoginState(): Promise<LoginState>;
  listFolders(cursor?: string): Promise<Page<SourceFolder>>;
  listNotes(cursor?: string): Promise<Page<SourceNoteSummary>>;
  getNote(sourceId: string): Promise<CanonicalNote>;
  downloadAttachment(attachment: SourceAttachment): Promise<DownloadedAttachment>;
  createFolder(folder: SourceFolder): Promise<{ targetId: string }>;
  upsertNote(note: CanonicalNote, targetFolderId: string | null): Promise<TargetNote>;
  dispose(): Promise<void>;
}
