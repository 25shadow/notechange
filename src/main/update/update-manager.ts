import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

import type { UpdateStatus } from '../../shared/ipc';

export class UpdateManager {
  private status: UpdateStatus;
  private readonly updateUrl = __NOTECHANGE_UPDATE_URL__ || process.env.NOTECHANGE_UPDATE_URL || '';

  constructor() {
    this.status = this.ready() ? { state: 'idle', version: null, progress: null, message: '可检查更新' } : { state: 'unavailable', version: null, progress: null, message: '当前版本未配置更新服务' };
    if (!this.ready()) return;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: this.updateUrl });
    autoUpdater.on('update-available', (info) => this.set({ state: 'available', version: info.version, progress: null, message: `发现新版本 ${info.version}` }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'latest', version: app.getVersion(), progress: null, message: '已是最新版本' }));
    autoUpdater.on('download-progress', (progress) => this.set({ state: 'downloading', version: this.status.version, progress: Math.round(progress.percent), message: `正在下载更新 ${Math.round(progress.percent)}%` }));
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'downloaded', version: info.version, progress: 100, message: '更新已下载，重启后安装' }));
    autoUpdater.on('error', () => this.set({ state: 'error', version: null, progress: null, message: '检查更新失败' }));
  }

  getStatus(): UpdateStatus { return this.status; }
  async check(listener?: (status: UpdateStatus) => void): Promise<UpdateStatus> {
    if (!this.ready()) return this.status;
    this.listener = listener;
    this.set({ state: 'checking', version: null, progress: null, message: '正在检查更新' });
    await autoUpdater.checkForUpdates();
    return this.status;
  }
  async download(listener?: (status: UpdateStatus) => void): Promise<UpdateStatus> {
    if (this.status.state !== 'available') return this.status;
    this.listener = listener;
    await autoUpdater.downloadUpdate();
    return this.status;
  }
  install(): void { if (this.status.state === 'downloaded') autoUpdater.quitAndInstall(); }

  private listener: ((status: UpdateStatus) => void) | undefined;
  private ready(): boolean { return app.isPackaged && Boolean(this.updateUrl); }
  private set(status: UpdateStatus): void { this.status = status; this.listener?.(status); }
}

declare const __NOTECHANGE_UPDATE_URL__: string;
