export type VivoSyncNote = {
  guid: string;
  title: string;
  contentDigest: string;
  content: string;
  conflictTime: null;
  createTime: number;
  updateTime: number;
  contentUpdateTime: number;
  attrUpdateTime: number;
  importantLevel: 0;
  noteBookGuid: string;
  tags: [];
  deleted: 1;
  dirty: 1;
  type: 1;
  contentLoaded: true;
  symbolCnf: '';
  paperTexture: '0';
  bgColor: 101;
  pageMargins: string;
  syncProtocolVersion: 0;
  isAiNote: 0;
  aiQuery: '';
};

export type VivoCreateSyncRequest = {
  type: 0;
  lastUpdateCount: number;
  noteBooks: [];
  notes: VivoSyncNote[];
  tags: [];
  resources: VivoSyncResource[];
};

export type VivoSyncResource = {
  guid: string;
  name: string;
  mime: string;
  resourceKey: string;
  domainAddr: string;
  resourceSize: number;
  resType: 1;
  noteGuid: string;
  createTime: number;
  updateTime: number;
  fileID: string;
  dirty: 1;
  deleted: 1;
  sort: number;
  category: 3;
};
