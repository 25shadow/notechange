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
  logout: (provider: CloudProvider) => ipcRenderer.invoke(ipcChannels.logout, provider),
  scanXiaomi: () => ipcRenderer.invoke(ipcChannels.scanXiaomi),
  getLatestExportSummary: () => ipcRenderer.invoke(ipcChannels.getLatestExportSummary),
  listExports: () => ipcRenderer.invoke(ipcChannels.listExports),
  selectExport: (batchId) => ipcRenderer.invoke(ipcChannels.selectExport, batchId),
  deleteExport: (batchId) => ipcRenderer.invoke(ipcChannels.deleteExport, batchId),
  getExportPreview: (query) => ipcRenderer.invoke(ipcChannels.getExportPreview, query),
  getExportPreviewDetail: (request) =>
    ipcRenderer.invoke(ipcChannels.getExportPreviewDetail, request),
  getExportAttachment: (request) =>
    ipcRenderer.invoke(ipcChannels.getExportAttachment, request),
  confirmMigration: () => ipcRenderer.invoke(ipcChannels.confirmMigration),
  startImport: () => ipcRenderer.invoke(ipcChannels.startImport),
  cancelMigration: () => ipcRenderer.invoke(ipcChannels.cancelMigration)
};

contextBridge.exposeInMainWorld('notechange', api);
