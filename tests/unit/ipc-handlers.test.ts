import { describe, expect, it, vi } from 'vitest';

import { ipcChannels } from '../../src/shared/ipc';
import { registerMigrationIpc } from '../../src/main/runtime/ipc-handlers';

describe('registerMigrationIpc', () => {
  it('只注册迁移白名单命令并拒绝未知厂商', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      })
    };
    const runtime = {
      getLoginState: vi.fn(async () => ({ authenticated: false, accountLabel: null })),
      startLogin: vi.fn(async () => ({ authenticated: true, accountLabel: null })),
      scanXiaomi: vi.fn(async () => ({ noteCount: 0, attachmentCount: 0, warningCount: 0 })),
      getLatestExportSummary: vi.fn(async () => null),
      getExportPreview: vi.fn(async () => ({ total: 0, items: [] })),
      getExportPreviewDetail: vi.fn(),
      getExportAttachment: vi.fn(),
      confirmMigration: vi.fn(),
      startImport: vi.fn(async () => ({
        created: 0,
        skipped: 0,
        failed: 0,
        manualReview: 0,
        cancelled: false
      })),
      cancelMigration: vi.fn()
    };

    registerMigrationIpc(ipcMain, runtime);

    expect([...handlers.keys()].sort()).toEqual(Object.values(ipcChannels).sort());
    await expect(
      handlers.get(ipcChannels.startLogin)?.({}, 'unknown')
    ).rejects.toThrow('INVALID_PROVIDER');

    const query = { search: '', filter: 'all', offset: 0, limit: 50 } as const;
    await handlers.get(ipcChannels.getExportPreview)?.({}, query);
    expect(runtime.getExportPreview).toHaveBeenCalledWith(query);
    await handlers.get(ipcChannels.getExportPreviewDetail)?.({}, 'note-1');
    expect(runtime.getExportPreviewDetail).toHaveBeenCalledWith('note-1');
    await handlers.get(ipcChannels.getExportAttachment)?.({}, 'note-1', 'a'.repeat(64));
    expect(runtime.getExportAttachment).toHaveBeenCalledWith('note-1', 'a'.repeat(64));
  });
});
