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
  confirmMigration: () => ipcRenderer.invoke(ipcChannels.confirmMigration),
  startImport: () => ipcRenderer.invoke(ipcChannels.startImport),
  cancelMigration: () => ipcRenderer.invoke(ipcChannels.cancelMigration)
};

contextBridge.exposeInMainWorld('notechange', api);
