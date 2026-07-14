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
  ipcMain.handle(ipcChannels.confirmMigration, async () => runtime.confirmMigration());
  ipcMain.handle(ipcChannels.startImport, async () => runtime.startImport());
  ipcMain.handle(ipcChannels.cancelMigration, async () => runtime.cancelMigration());
}

function parseProvider(value: unknown): CloudProvider {
  if (value !== 'xiaomi' && value !== 'vivo') throw new Error('INVALID_PROVIDER');
  return value;
}
