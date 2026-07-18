// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App, type RendererMigrationApi } from '../../src/renderer/App';

afterEach(cleanup);

describe('导出笔记预览', () => {
  it('点击导入直接打开平台选择，不打开预览', async () => {
    const api: RendererMigrationApi = {
      getLoginState: vi.fn(async (provider) => ({ authenticated: provider === 'xiaomi', accountLabel: null })),
      startLogin: vi.fn(), scanXiaomi: vi.fn(),
      getLatestExportSummary: vi.fn(async () => null),
      listExports: vi.fn(async () => [{ batchId: 'batch-1', exportedAt: '2026-07-17T00:00:00.000Z', noteCount: 1, attachmentCount: 0, warningCount: 0 }]),
      selectExport: vi.fn(async () => ({ batchId: 'batch-1', exportedAt: '2026-07-17T00:00:00.000Z', noteCount: 1, attachmentCount: 0, warningCount: 0 })),
      deleteExport: vi.fn(),
      getExportPreview: vi.fn(async () => ({ total: 1, items: [{ sourceId: 'n1', title: '标题', excerpt: '正文', modifiedAt: null, attachmentCount: 0, warningCount: 0 }] })),
      getExportPreviewDetail: vi.fn(async () => ({ sourceId: 'n1', folderSourceId: null, title: '标题', plainText: '正文', createdAt: null, modifiedAt: null, attachments: [], warnings: [] })),
      getExportAttachment: vi.fn(), confirmMigration: vi.fn(), startImport: vi.fn(), cancelMigration: vi.fn()
    };
    render(<App api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: '导入' }));
    expect(await screen.findByRole('button', { name: '导入到 vivo 原子笔记' })).toBeDisabled();
    expect(screen.queryByRole('dialog', { name: '小米笔记预览' })).toBeNull();
  });

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
      listExports: vi.fn(async () => [{
        batchId: 'batch-1',
        exportedAt: '2026-07-17T00:00:00.000Z',
        noteCount: 318,
        attachmentCount: 19,
        warningCount: 245
      }]),
      selectExport: vi.fn(async () => ({
        batchId: 'batch-1',
        exportedAt: '2026-07-17T00:00:00.000Z',
        noteCount: 318,
        attachmentCount: 19,
        warningCount: 245
      })),
      deleteExport: vi.fn(),
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
        plainText: '<img src=x onerror=alert(1)>\n前文\n☺ file-a<0/>\n中间\n☺ file-b\n结尾',
        createdAt: null,
        modifiedAt: '2026-07-17T00:00:00.000Z',
        attachments: [
          { sourceId: 'file-a', sha256: 'a'.repeat(64), filename: 'a.jpg', mimeType: 'image/jpeg' },
          { sourceId: 'file-b', sha256: 'b'.repeat(64), filename: 'b.png', mimeType: 'image/png' },
          { sourceId: 'voice', sha256: 'c'.repeat(64), filename: 'voice.mp3', mimeType: 'audio/mp3' }
        ],
        warnings: [{ code: 'unsupported-content', message: '包含需核对内容' }]
      })),
      getExportAttachment: vi.fn(async (request) => ({
        mimeType: request.sha256.startsWith('a') ? 'image/jpeg' : 'image/png',
        base64: 'AA=='
      })),
      confirmMigration: vi.fn(),
      startImport: vi.fn(async () => ({ created: 1, skipped: 0, failed: 0, manualReview: 0, cancelled: false })),
      cancelMigration: vi.fn()
    };
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: '查看' }));
    expect(await screen.findByRole('dialog', { name: '小米笔记预览' })).toBeVisible();
    expect(await screen.findByText('会议记录')).toBeVisible();
    expect(await screen.findByText(/<img src=x/)).toBeVisible();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    const detailBody = await screen.findByTestId('preview-note-content');
    expect([...detailBody.children].map((node) => node.getAttribute('data-kind'))).toEqual([
      'text', 'attachment', 'text', 'attachment', 'text'
    ]);
    expect(await screen.findByAltText('a.jpg')).toBeVisible();
    expect(await screen.findByAltText('b.png')).toBeVisible();
    expect(screen.getByText('其他附件')).toBeVisible();
    expect(screen.getByText('voice.mp3')).toBeVisible();
    expect(screen.queryByText('需处理')).toBeNull();
    expect(screen.queryByText('包含需核对内容')).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索导出笔记' }), {
      target: { value: '项目' }
    });
    await waitFor(() =>
      expect(api.getExportPreview).toHaveBeenLastCalledWith(
        expect.objectContaining({ batchId: 'batch-1', search: '项目', filter: 'all', offset: 0, limit: 50 })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
