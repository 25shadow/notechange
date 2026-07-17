// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App, type RendererMigrationApi } from '../../src/renderer/App';

afterEach(cleanup);

describe('导出笔记预览', () => {
  it('恢复本地批次并搜索查看纯文本详情', async () => {
    const api: RendererMigrationApi = {
      getLoginState: vi.fn(async () => ({ authenticated: true, accountLabel: null })),
      startLogin: vi.fn(),
      scanXiaomi: vi.fn(),
      getLatestExportSummary: vi.fn(async () => ({
        batchId: 'batch-1',
        exportedAt: '2026-07-17T00:00:00.000Z',
        noteCount: 318,
        attachmentCount: 19,
        warningCount: 245
      })),
      getExportPreview: vi.fn(async (query) => ({
        total: 1,
        items: [{
          sourceId: 'note-1',
          title: '会议记录',
          excerpt: '项目进度',
          modifiedAt: '2026-07-17T00:00:00.000Z',
          attachmentCount: 0,
          warningCount: 1
        }]
      })),
      getExportPreviewDetail: vi.fn(async () => ({
        sourceId: 'note-1',
        folderSourceId: null,
        title: '会议记录',
        plainText: '<img src=x onerror=alert(1)>\n项目进度',
        createdAt: null,
        modifiedAt: '2026-07-17T00:00:00.000Z',
        attachments: [],
        warnings: [{ code: 'unsupported-content', message: '包含需核对内容' }]
      })),
      getExportAttachment: vi.fn(),
      confirmMigration: vi.fn(),
      startImport: vi.fn(),
      cancelMigration: vi.fn()
    };
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: '查看导出内容' }));
    expect(await screen.findByRole('dialog', { name: '小米笔记预览' })).toBeVisible();
    expect(await screen.findByText('会议记录')).toBeVisible();
    expect(await screen.findByText(/<img src=x/)).toBeVisible();
    expect(document.querySelector('img[src="x"]')).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索导出笔记' }), {
      target: { value: '项目' }
    });
    await waitFor(() =>
      expect(api.getExportPreview).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: '项目', filter: 'all', offset: 0, limit: 50 })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
