import { randomUUID } from 'node:crypto';

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
import type { VivoCreateSyncRequest, VivoSyncNote } from './vivo-sync-types';

export class VivoProvider implements NotesProvider {
  readonly id = 'vivo' as const;

  constructor(private readonly api: VivoApi) {}

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

  async listNotes(): Promise<Page<SourceNoteSummary>> {
    throw new Error('VIVO_LIST_PAYLOAD_UNVERIFIED');
  }

  async getNote(): Promise<CanonicalNote> {
    throw new Error('VIVO_GET_PAYLOAD_UNVERIFIED');
  }

  async downloadAttachment(_attachment: SourceAttachment): Promise<DownloadedAttachment> {
    throw new Error('VIVO_ATTACHMENT_CONTRACT_UNVERIFIED');
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
    const syncNote: VivoSyncNote = {
      guid,
      title: note.title,
      contentDigest: note.plainText.slice(0, 60),
      content: note.html,
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
      resources: []
    };
    const response = await this.api.createSync(payload);

    return {
      targetId: response.notes[0]?.guid ?? guid,
      modifiedAt: new Date(modifiedAt).toISOString()
    };
  }

  async dispose(): Promise<void> {}
}
