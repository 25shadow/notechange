import { ipcChannels, type CloudProvider, type ImportProgress } from '../../shared/ipc';
import type { MigrationRuntime } from './migration-runtime';
import type { LicenseManager } from '../license/license-manager';
import type { UpdateManager } from '../update/update-manager';

type IpcEventLike = { sender: { send(channel: string, ...args: unknown[]): void } };

type IpcMainLike = {
  handle(channel: string, handler: (event: IpcEventLike, ...args: unknown[]) => unknown): void;
};

type MigrationRuntimeCommands = Pick<
  MigrationRuntime,
  | 'getLoginState'
  | 'startLogin'
  | 'scanXiaomi'
  | 'getLatestExportSummary'
  | 'listExports'
  | 'selectExport'
  | 'deleteExport'
  | 'getExportPreview'
  | 'getExportPreviewDetail'
  | 'getExportAttachment'
  | 'confirmMigration'
  | 'startImport'
  | 'cancelMigration'
  | 'openNoteCenter'
  | 'listImportHistory'
  | 'getImportHistory'
> & Partial<Pick<MigrationRuntime, 'logout' | 'scanVivo'>>;

export function registerMigrationIpc(
  ipcMain: IpcMainLike,
  runtime: MigrationRuntimeCommands,
  licenseManager?: Pick<LicenseManager, 'getStatus' | 'activate' | 'deactivate'>,
  updateManager?: Pick<UpdateManager, 'getStatus' | 'check' | 'download' | 'install'>
): void {
  ipcMain.handle(ipcChannels.getUpdateStatus, async () => updateManager?.getStatus());
  ipcMain.handle(ipcChannels.checkForUpdates, async () => updateManager?.check());
  ipcMain.handle(ipcChannels.downloadUpdate, async () => updateManager?.download());
  ipcMain.handle(ipcChannels.installUpdate, async () => updateManager?.install());
  ipcMain.handle(ipcChannels.getLicenseStatus, async () => licenseManager?.getStatus() ?? ({ state: 'unconfigured', licenseId: null, message: '授权服务尚未配置' }));
  ipcMain.handle(ipcChannels.activateLicense, async (_event, code) => {
    if (!licenseManager) throw new Error('LICENSE_SERVICE_UNCONFIGURED');
    return licenseManager.activate(String(code));
  });
  ipcMain.handle(ipcChannels.deactivateLicense, async () => {
    if (!licenseManager) throw new Error('LICENSE_SERVICE_UNCONFIGURED');
    return licenseManager.deactivate();
  });
  ipcMain.handle(ipcChannels.getLoginState, async (_event, provider) =>
    runtime.getLoginState(parseProvider(provider))
  );
  ipcMain.handle(ipcChannels.startLogin, async (_event, provider) =>
    runtime.startLogin(parseProvider(provider))
  );
  ipcMain.handle(ipcChannels.logout, async (_event, provider) =>
    runtime.logout?.(parseProvider(provider))
  );
  ipcMain.handle(ipcChannels.scanXiaomi, async (event) => runtime.scanXiaomi((progress) =>
    event.sender.send(ipcChannels.exportProgress, progress)
  ));
  ipcMain.handle(ipcChannels.scanVivo, async (event) => {
    if (!runtime.scanVivo) throw new Error('VIVO_EXPORT_UNAVAILABLE');
    return runtime.scanVivo((progress) => event.sender.send(ipcChannels.exportProgress, progress));
  });
  ipcMain.handle(ipcChannels.getLatestExportSummary, async () =>
    runtime.getLatestExportSummary()
  );
  ipcMain.handle(ipcChannels.listExports, async () => runtime.listExports());
  ipcMain.handle(ipcChannels.selectExport, async (_event, batchId) =>
    runtime.selectExport(String(batchId))
  );
  ipcMain.handle(ipcChannels.deleteExport, async (_event, batchId) =>
    runtime.deleteExport(String(batchId))
  );
  ipcMain.handle(ipcChannels.getExportPreview, async (_event, query) =>
    runtime.getExportPreview(query as Parameters<MigrationRuntime['getExportPreview']>[0])
  );
  ipcMain.handle(ipcChannels.getExportPreviewDetail, async (_event, request) =>
    runtime.getExportPreviewDetail(
      request as Parameters<MigrationRuntime['getExportPreviewDetail']>[0]
    )
  );
  ipcMain.handle(ipcChannels.getExportAttachment, async (_event, request) =>
    runtime.getExportAttachment(
      request as Parameters<MigrationRuntime['getExportAttachment']>[0]
    )
  );
  ipcMain.handle(ipcChannels.confirmMigration, async () => runtime.confirmMigration());
  ipcMain.handle(ipcChannels.startImport, async (event) =>
    runtime.startImport((progress: ImportProgress) =>
      event.sender.send(ipcChannels.importProgress, progress)
    )
  );
  ipcMain.handle(ipcChannels.cancelMigration, async () => runtime.cancelMigration());
  ipcMain.handle(ipcChannels.openNoteCenter, async (_event, provider) =>
    runtime.openNoteCenter(parseProvider(provider))
  );
  ipcMain.handle(ipcChannels.listImportHistory, async () => runtime.listImportHistory());
  ipcMain.handle(ipcChannels.getImportHistory, async (_event, taskId) =>
    runtime.getImportHistory(parseTaskId(taskId))
  );
}

function parseTaskId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('INVALID_TASK_ID');
  }
  return value;
}

function parseProvider(value: unknown): CloudProvider {
  if (value !== 'xiaomi' && value !== 'vivo') throw new Error('INVALID_PROVIDER');
  return value;
}
