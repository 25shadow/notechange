// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App, type RendererMigrationApi } from '../../src/renderer/App';

afterEach(cleanup);

function fakeApi(): RendererMigrationApi {
  let scanned = false;
  const summary = {
    batchId: 'batch-1',
    exportedAt: '2026-07-17T00:00:00.000Z',
    noteCount: 12,
    attachmentCount: 4,
    warningCount: 2
  };
  return {
    getLoginState: vi.fn(async () => ({ authenticated: true, accountLabel: null })),
    startLogin: vi.fn(async () => ({ authenticated: true, accountLabel: null })),
    scanXiaomi: vi.fn(async () => {
      scanned = true;
      return { noteCount: 12, attachmentCount: 4, warningCount: 2 };
    }),
    getLatestExportSummary: vi.fn(async () => scanned ? summary : null),
    listExports: vi.fn(async () => scanned ? [summary] : []),
    selectExport: vi.fn(async () => summary),
    deleteExport: vi.fn(async () => undefined),
    getExportPreview: vi.fn(async () => ({ total: 0, items: [] })),
    getExportPreviewDetail: vi.fn(),
    getExportAttachment: vi.fn(),
    confirmMigration: vi.fn(async () => undefined),
    startImport: vi.fn(async () => ({
      created: 10,
      skipped: 1,
      failed: 0,
      manualReview: 1,
      cancelled: false
    })),
    cancelMigration: vi.fn(async () => undefined)
  };
}

function xiaomiOnlyApi(): RendererMigrationApi {
  const api = fakeApi();
  api.getLoginState = vi.fn(async (provider) => ({
    authenticated: provider === 'xiaomi',
    accountLabel: null
  }));
  return api;
}

describe('小米到 vivo 迁移工作区', () => {
  it('显示中文登录状态并通过平台选择导出小米笔记', async () => {
    const api = fakeApi();
    render(<App api={api} />);

    await waitFor(() =>
      expect(screen.getAllByText('已登录')).toHaveLength(2)
    );
    fireEvent.click(screen.getByRole('button', { name: '导出笔记' }));
    expect(await screen.findByRole('dialog', { name: '选择导出平台' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '小米云笔记' }));

    const statistics = await screen.findByRole('table', { name: '本地导出批次' });
    expect(within(statistics).getByText('12')).toBeTruthy();
    expect(within(statistics).getByText('4')).toBeTruthy();
    expect(within(statistics).getByText('小米云笔记')).toBeTruthy();
    const actions = within(statistics).getAllByRole('button').map((button) => button.textContent);
    expect(actions.indexOf('导入')).toBeLessThan(actions.indexOf('查看'));
    expect(within(statistics).queryByText('需处理')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: '我已核对目标账号和迁移数量' })).toBeNull();
    expect(screen.getByText('小米笔记导出成功')).toBeVisible();
    expect(screen.getByRole('button', { name: '退出登录小米云笔记' })).toBeVisible();
    expect(screen.getAllByRole('log').length).toBeGreaterThanOrEqual(1);
  });

  it('未登录时导出按钮仍可打开选择器，但小米选项禁用', async () => {
    const api = fakeApi();
    api.getLoginState = vi.fn(async () => ({ authenticated: false, accountLabel: null }));
    render(<App api={api} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '登录vivo 原子笔记' })).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: '导出笔记' }));
    expect(screen.getByRole('dialog', { name: '选择导出平台' })).toBeVisible();
    expect(screen.getByRole('button', { name: '小米云笔记' })).toBeDisabled();
  });

  it('小米登录后立即允许导出，但 vivo 未登录时禁止导入', async () => {
    const api = xiaomiOnlyApi();
    render(<App api={api} />);

    await waitFor(() => expect(screen.getAllByText('已登录')).toHaveLength(1));
    expect(screen.getByRole('button', { name: '导出笔记' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '导出笔记' }));
    expect(screen.getByRole('button', { name: /vivo 原子笔记（暂未支持）/ })).toBeDisabled();
  });

  it('展示历史批次并在确认后只删除所选批次', async () => {
    const api = fakeApi();
    const first = {
      batchId: 'batch-2',
      exportedAt: '2026-07-17T02:00:00.000Z',
      noteCount: 20,
      attachmentCount: 3,
      warningCount: 1
    };
    const second = {
      batchId: 'batch-1',
      exportedAt: '2026-07-16T02:00:00.000Z',
      noteCount: 10,
      attachmentCount: 1,
      warningCount: 0
    };
    api.listExports = vi.fn(async () => [first, second]);
    api.selectExport = vi.fn(async (batchId) => batchId === first.batchId ? first : second);
    api.deleteExport = vi.fn(async () => undefined);
    render(<App api={api} />);

    const table = await screen.findByRole('table', { name: '本地导出批次' });
    expect(within(table).getByText('20')).toBeVisible();
    expect(within(table).getByText('10')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '删除批次 batch-2' }));
    const dialog = await screen.findByRole('dialog', { name: '删除本地导出批次' });
    expect(within(dialog).getByText(/只会删除 NoteChange 本地保存/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(api.deleteExport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '删除批次 batch-2' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: '删除本地导出批次' }))
        .getByRole('button', { name: '删除本地批次' })
    );
    await waitFor(() => expect(api.deleteExport).toHaveBeenCalledWith(first.batchId));
  });
});
