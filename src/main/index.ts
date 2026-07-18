import { join } from 'node:path';

import { app, BrowserWindow, ipcMain } from 'electron';

import { SessionManager } from './browser/session-manager';
import { browserProfileRoot } from './browser/profile-root';
import { registerMigrationIpc } from './runtime/ipc-handlers';
import { MigrationRuntime } from './runtime/migration-runtime';
import { createProvider } from './runtime/provider-factory';
import { MemoryMigrationCheckpointStore } from './storage/memory-checkpoint-store';
import { FileExportBundleStore } from './storage/file-export-bundle-store';
import { exportRoot } from './storage/export-root';

let migrationRuntime: MigrationRuntime | null = null;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  migrationRuntime = new MigrationRuntime({
    sessionManager: new SessionManager(
      { headless: false },
      browserProfileRoot(app.getPath('userData'))
    ),
    createProvider,
    checkpoints: new MemoryMigrationCheckpointStore(),
    exports: new FileExportBundleStore(exportRoot(app.getPath('userData')))
  });
  registerMigrationIpc(ipcMain, migrationRuntime);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void migrationRuntime?.dispose();
});
