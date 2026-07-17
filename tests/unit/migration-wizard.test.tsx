// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App, type RendererMigrationApi } from '../../src/renderer/App';

afterEach(cleanup);

function fakeApi(): RendererMigrationApi {
  return {
    getLoginState: vi.fn(async () => ({ authenticated: true, accountLabel: null })),
    startLogin: vi.fn(async () => ({ authenticated: true, accountLabel: null })),
    scanXiaomi: vi.fn(async () => ({ noteCount: 12, attachmentCount: 4, warningCount: 2 })),
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
  it('导出预览并在明确确认前禁用导入', async () => {
    const api = fakeApi();
    render(<App api={api} />);

    await waitFor(() =>
      expect(screen.getAllByText('已连接')).toHaveLength(2)
    );
    fireEvent.click(screen.getByRole('button', { name: '导出小米笔记' }));

    const statistics = await screen.findByLabelText('导出统计');
    expect(within(statistics).getByText('12')).toBeTruthy();
    expect(within(statistics).getByText('4')).toBeTruthy();
    expect(within(statistics).getByText('2')).toBeTruthy();
    const importButton = screen.getByRole('button', { name: '导入 vivo' });
    expect(importButton).toBeDisabled();

    fireEvent.click(
      screen.getByRole('checkbox', { name: '我已核对目标账号和迁移数量' })
    );
    expect(importButton).toBeEnabled();
    fireEvent.click(importButton);

    await waitFor(() => expect(api.confirmMigration).toHaveBeenCalledOnce());
    await waitFor(() => expect(api.startImport).toHaveBeenCalledOnce());
    expect(await screen.findByText('已创建 10 条')).toBeTruthy();
  });

  it('小米登录后立即允许导出，但 vivo 未登录时禁止导入', async () => {
    const api = xiaomiOnlyApi();
    render(<App api={api} />);

    await waitFor(() => expect(screen.getAllByText('已连接')).toHaveLength(1));
    expect(screen.getByRole('button', { name: '导出小米笔记' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '导出小米笔记' }));
    await screen.findByLabelText('导出统计');
    fireEvent.click(
      screen.getByRole('checkbox', { name: '我已核对目标账号和迁移数量' })
    );

    expect(screen.getByRole('button', { name: '导入 vivo' })).toBeDisabled();
  });
});
