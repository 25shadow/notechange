import { ipcChannels, type CloudProvider } from '../../shared/ipc';
import type { MigrationRuntime } from './migration-runtime';

type IpcMainLike = {
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void;
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
>;

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
  ipcMain.handle(ipcChannels.startImport, async () => runtime.startImport());
  ipcMain.handle(ipcChannels.cancelMigration, async () => runtime.cancelMigration());
}

function parseProvider(value: unknown): CloudProvider {
  if (value !== 'xiaomi' && value !== 'vivo') throw new Error('INVALID_PROVIDER');
  return value;
}
