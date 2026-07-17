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
  ipcMain.handle(ipcChannels.getExportPreview, async (_event, query) =>
    runtime.getExportPreview(query as Parameters<MigrationRuntime['getExportPreview']>[0])
  );
  ipcMain.handle(ipcChannels.getExportPreviewDetail, async (_event, sourceId) =>
    runtime.getExportPreviewDetail(String(sourceId))
  );
  ipcMain.handle(ipcChannels.getExportAttachment, async (_event, sourceId, sha256) =>
    runtime.getExportAttachment(String(sourceId), String(sha256))
  );
  ipcMain.handle(ipcChannels.confirmMigration, async () => runtime.confirmMigration());
  ipcMain.handle(ipcChannels.startImport, async () => runtime.startImport());
  ipcMain.handle(ipcChannels.cancelMigration, async () => runtime.cancelMigration());
}

function parseProvider(value: unknown): CloudProvider {
  if (value !== 'xiaomi' && value !== 'vivo') throw new Error('INVALID_PROVIDER');
  return value;
}
