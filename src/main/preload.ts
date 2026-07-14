import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('notechange', {});
