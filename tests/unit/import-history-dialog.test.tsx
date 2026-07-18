// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App, type RendererMigrationApi } from '../../src/renderer/App';
import type { ImportHistoryTask, ImportProgress } from '../../src/shared/ipc';

afterEach(cleanup);

const progress: ImportProgress = {
  taskId: 'task-1', total: 4, completed: 2, created: 1, skipped: 1, failed: 0, manualReview: 0,
  current: { sourceId: 'note-3', title: '会议记录', outcome: 'created' }, occurredAt: '2026-07-18T10:02:00.000Z'
};

const history: ImportHistoryTask = {
  schemaVersion: 1, taskId: 'task-1', batchId: 'batch-1', source: 'xiaomi', target: 'vivo',
  status: 'completed-with-issues', startedAt: '2026-07-18T10:00:00.000Z', completedAt: '2026-07-18T10:03:00.000Z',
  progress: { ...progress, completed: 4, created: 2, failed: 1, manualReview: 1 },
  logs: [{ occurredAt: '2026-07-18T10:01:00.000Z', message: '已导入 会议记录', kind: 'success' }],
  failures: [{ sourceId: 'note-4', title: '待核对笔记', outcome: 'manual-review', errorCode: 'VIVO_ATTACHMENT_UPLOAD_UNVERIFIED', message: 'VIVO_ATTACHMENT_UPLOAD_UNVERIFIED', attachment: { filename: 'fixture.png', mimeType: 'image/png' }, occurredAt: '2026-07-18T10:03:00.000Z' }]
};

function makeApi(overrides: Partial<RendererMigrationApi> = {}): RendererMigrationApi {
  return {
    getLoginState: vi.fn(async () => ({ authenticated: true, accountLabel: null })), startLogin: vi.fn(), logout: vi.fn(), scanXiaomi: vi.fn(),
    getLatestExportSummary: vi.fn(async () => null), listExports: vi.fn(async () => []), selectExport: vi.fn(), deleteExport: vi.fn(),
    getExportPreview: vi.fn(async () => ({ total: 0, items: [] })), getExportPreviewDetail: vi.fn(), getExportAttachment: vi.fn(),
    confirmMigration: vi.fn(), startImport: vi.fn(async () => ({ created: 0, skipped: 0, failed: 0, manualReview: 0, cancelled: false })), cancelMigration: vi.fn(),
    openNoteCenter: vi.fn(), listImportHistory: vi.fn(async () => [history]), getImportHistory: vi.fn(async () => history),
    ...overrides
  };
}

describe('导入进度与历史', () => {
  it('显示实时导入进度并可取消', async () => {
    let listener: ((next: ImportProgress) => void) | undefined;
    const api = makeApi({ onImportProgress: vi.fn((next) => { listener = next; return vi.fn(); }) });
    render(<App api={api} />);

    await waitFor(() => expect(listener).toBeDefined());
    listener?.(progress);

    const dialog = await screen.findByRole('dialog', { name: '正在导入笔记' });
    expect(dialog).toBeVisible();
    expect(screen.getByText('会议记录')).toBeVisible();
    expect(screen.getByText('2 / 4')).toBeVisible();
    expect(within(dialog).getByText('正在导入：会议记录')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消导入' }));
    expect(api.cancelMigration).toHaveBeenCalledOnce();
  });

  it('打开导入历史详情并显示人工核对记录', async () => {
    const api = makeApi();
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: '查看导入详情 task-1' }));
    expect(await screen.findByRole('dialog', { name: '导入历史详情' })).toBeVisible();
    expect(screen.getByText('待核对笔记')).toBeVisible();
    expect(await screen.findByText('附件未迁移：fixture.png')).toBeTruthy();
    expect(screen.getByText('vivo 网页端附件上传尚未验证')).toBeTruthy();
  });

  it('为已登录账号打开笔记中心', async () => {
    const api = makeApi();
    render(<App api={api} />);

    fireEvent.click((await screen.findAllByRole('button', { name: '打开笔记中心' }))[0]);
    expect(api.openNoteCenter).toHaveBeenCalledWith('xiaomi');
    expect(await screen.findByText('已打开小米云笔记笔记中心')).toBeVisible();
  });

  it('打开笔记中心失败时显示错误提示', async () => {
    const api = makeApi({ openNoteCenter: vi.fn(async () => { throw new Error('OPEN_FAILED'); }) });
    render(<App api={api} />);

    fireEvent.click((await screen.findAllByRole('button', { name: '打开笔记中心' }))[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('无法打开笔记中心。');
    expect(screen.getByText('打开小米云笔记笔记中心失败')).toBeVisible();
  });
});
