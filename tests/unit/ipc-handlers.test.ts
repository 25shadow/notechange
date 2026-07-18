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
      logout: vi.fn(async () => undefined),
      scanXiaomi: vi.fn(async () => ({ noteCount: 0, attachmentCount: 0, warningCount: 0 })),
      getLatestExportSummary: vi.fn(async () => null),
      listExports: vi.fn(async () => []),
      selectExport: vi.fn(async () => ({
        batchId: 'batch-1',
        exportedAt: '2026-07-17T00:00:00.000Z',
        noteCount: 1,
        attachmentCount: 0,
        warningCount: 0
      })),
      deleteExport: vi.fn(async () => undefined),
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

    await handlers.get(ipcChannels.listExports)?.({});
    expect(runtime.listExports).toHaveBeenCalledOnce();
    await handlers.get(ipcChannels.logout)?.({}, 'xiaomi');
    expect(runtime.logout).toHaveBeenCalledWith('xiaomi');
    await handlers.get(ipcChannels.selectExport)?.({}, 'batch-1');
    expect(runtime.selectExport).toHaveBeenCalledWith('batch-1');
    await handlers.get(ipcChannels.deleteExport)?.({}, 'batch-1');
    expect(runtime.deleteExport).toHaveBeenCalledWith('batch-1');

    const query = { batchId: 'batch-1', search: '', filter: 'all', offset: 0, limit: 50 } as const;
    await handlers.get(ipcChannels.getExportPreview)?.({}, query);
    expect(runtime.getExportPreview).toHaveBeenCalledWith(query);
    const detailRequest = { batchId: 'batch-1', sourceId: 'note-1' };
    await handlers.get(ipcChannels.getExportPreviewDetail)?.({}, detailRequest);
    expect(runtime.getExportPreviewDetail).toHaveBeenCalledWith(detailRequest);
    const attachmentRequest = { ...detailRequest, sha256: 'a'.repeat(64) };
    await handlers.get(ipcChannels.getExportAttachment)?.({}, attachmentRequest);
    expect(runtime.getExportAttachment).toHaveBeenCalledWith(attachmentRequest);
  });
});
