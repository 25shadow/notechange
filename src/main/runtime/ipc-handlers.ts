import { ipcChannels, type CloudProvider, type ImportProgress } from '../../shared/ipc';
import type { MigrationRuntime } from './migration-runtime';

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
> & Partial<Pick<MigrationRuntime, 'logout'>>;

export function registerMigrationIpc(
  ipcMain: IpcMainLike,
  runtime: MigrationRuntimeCommands
): void {
  ipcMain.handle(ipcChannels.getLoginState, async (_event, provider) =>
    runtime.getLoginState(parseProvider(provider))
  );
  ipcMain.handle(ipcChannels.startLogin, async (_event, provider) =>
    runtime.startLogin(parseProvider(provider))
  );
  ipcMain.handle(ipcChannels.logout, async (_event, provider) =>
    runtime.logout?.(parseProvider(provider))
  );
  ipcMain.handle(ipcChannels.scanXiaomi, async () => runtime.scanXiaomi());
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
