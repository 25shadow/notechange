import { contextBridge, ipcRenderer } from 'electron';

import {
  ipcChannels,
  type CloudProvider,
  type NoteChangeApi
} from '../shared/ipc';

const api: NoteChangeApi = {
  getUpdateStatus: () => ipcRenderer.invoke(ipcChannels.getUpdateStatus),
  checkForUpdates: () => ipcRenderer.invoke(ipcChannels.checkForUpdates),
  downloadUpdate: () => ipcRenderer.invoke(ipcChannels.downloadUpdate),
  installUpdate: () => ipcRenderer.invoke(ipcChannels.installUpdate),
  getLicenseStatus: () => ipcRenderer.invoke(ipcChannels.getLicenseStatus),
  activateLicense: (code) => ipcRenderer.invoke(ipcChannels.activateLicense, code),
  deactivateLicense: () => ipcRenderer.invoke(ipcChannels.deactivateLicense),
  getLoginState: (provider: CloudProvider) =>
    ipcRenderer.invoke(ipcChannels.getLoginState, provider),
  startLogin: (provider: CloudProvider) =>
    ipcRenderer.invoke(ipcChannels.startLogin, provider),
  logout: (provider: CloudProvider) => ipcRenderer.invoke(ipcChannels.logout, provider),
  scanXiaomi: () => ipcRenderer.invoke(ipcChannels.scanXiaomi),
  scanVivo: () => ipcRenderer.invoke(ipcChannels.scanVivo),
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
  cancelMigration: () => ipcRenderer.invoke(ipcChannels.cancelMigration),
  openNoteCenter: (provider) => ipcRenderer.invoke(ipcChannels.openNoteCenter, provider),
  listImportHistory: () => ipcRenderer.invoke(ipcChannels.listImportHistory),
  getImportHistory: (taskId) => ipcRenderer.invoke(ipcChannels.getImportHistory, taskId),
  onImportProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) =>
      listener(progress);
    ipcRenderer.on(ipcChannels.importProgress, handler);
    return () => ipcRenderer.removeListener(ipcChannels.importProgress, handler);
  }
  , onExportProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) =>
      listener(progress);
    ipcRenderer.on(ipcChannels.exportProgress, handler);
    return () => ipcRenderer.removeListener(ipcChannels.exportProgress, handler);
  }
};

contextBridge.exposeInMainWorld('notechange', api);
