import { contextBridge, ipcRenderer } from 'electron';

import {
  ipcChannels,
  type CloudProvider,
  type NoteChangeApi
} from '../shared/ipc';

const api: NoteChangeApi = {
  getLoginState: (provider: CloudProvider) =>
    ipcRenderer.invoke(ipcChannels.getLoginState, provider),
  startLogin: (provider: CloudProvider) =>
    ipcRenderer.invoke(ipcChannels.startLogin, provider),
  scanXiaomi: () => ipcRenderer.invoke(ipcChannels.scanXiaomi),
  getLatestExportSummary: () => ipcRenderer.invoke(ipcChannels.getLatestExportSummary),
  getExportPreview: (query) => ipcRenderer.invoke(ipcChannels.getExportPreview, query),
  getExportPreviewDetail: (sourceId) =>
    ipcRenderer.invoke(ipcChannels.getExportPreviewDetail, sourceId),
  getExportAttachment: (sourceId, sha256) =>
    ipcRenderer.invoke(ipcChannels.getExportAttachment, sourceId, sha256),
  confirmMigration: () => ipcRenderer.invoke(ipcChannels.confirmMigration),
  startImport: () => ipcRenderer.invoke(ipcChannels.startImport),
  cancelMigration: () => ipcRenderer.invoke(ipcChannels.cancelMigration)
};

contextBridge.exposeInMainWorld('notechange', api);
