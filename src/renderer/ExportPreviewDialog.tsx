import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Paperclip,
  Search,
  X
} from 'lucide-react';

import type {
  ExportPreviewDetail,
  ExportPreviewFilter,
  ExportPreviewPage,
  LocalExportSummary,
  NoteChangeApi,
  RendererMigrationReport
} from '../shared/ipc';
import { splitInlineAttachments } from './inline-attachments';

const pageSize = 50;

export function ExportPreviewDialog({
  api,
  summary,
  onClose,
  vivoAuthenticated,
  initialImportOpen = false,
  onRequestImport
}: {
  api: NoteChangeApi;
  summary: LocalExportSummary | null;
  onClose: () => void;
  vivoAuthenticated: boolean;
  initialImportOpen?: boolean;
  onRequestImport: () => Promise<RendererMigrationReport>;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ExportPreviewFilter>('all');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ExportPreviewPage>({ total: 0, items: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExportPreviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [importPickerOpen, setImportPickerOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  useEffect(() => {
    if (initialImportOpen) setImportPickerOpen(true);
  }, [initialImportOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    if (!summary) return;
    setLoading(true);
    setError(false);
    void api
      .getExportPreview({ batchId: summary.batchId, search, filter, offset, limit: pageSize })
      .then((nextPage) => {
        if (!active) return;
        setPage(nextPage);
        setSelectedId((current) =>
          nextPage.items.some((item) => item.sourceId === current)
            ? current
            : nextPage.items[0]?.sourceId ?? null
        );
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [api, summary, search, filter, offset]);

  useEffect(() => {
    let active = true;
    setDetail(null);
    if (selectedId && summary) {
      void api
        .getExportPreviewDetail({ batchId: summary.batchId, sourceId: selectedId })
        .then((nextDetail) => active && setDetail(nextDetail))
        .catch(() => active && setError(true));
    }
    return () => {
      active = false;
    };
  }, [api, selectedId, summary]);

  const changeFilter = (next: ExportPreviewFilter) => {
    setFilter(next);
    setOffset(0);
  };

  return (
    <div className="preview-overlay" role="presentation">
      <section className="preview-dialog" role="dialog" aria-modal="true" aria-label="小米笔记预览">
        <header className="preview-dialog-header">
          <div>
            <h2>小米笔记预览</h2>
            <p>{summary ? `${summary.noteCount} 条笔记 · ${formatDate(summary.exportedAt)}` : '本地导出批次'}</p>
          </div>
          <button className="preview-icon-button" onClick={onClose} aria-label="关闭预览" title="关闭预览">
            <X size={19} />
          </button>
        </header>

        <div className="preview-toolbar">
          <label className="preview-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="搜索导出笔记"
              placeholder="搜索标题或正文"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
            />
          </label>
          <div className="preview-filters" aria-label="笔记筛选">
            {([
              ['all', '全部'],
              ['attachments', '有附件']
            ] as const).map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? 'active' : ''}
                onClick={() => changeFilter(value)}
                aria-pressed={filter === value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="preview-workspace">
          <aside className="preview-index" aria-label="导出笔记列表">
            <button className="button primary preview-import-button" onClick={() => setImportPickerOpen(true)}>导入</button>
            <div className="preview-index-count">{page.total} 条结果</div>
            <div className="preview-list">
              {loading ? (
                <div className="preview-loading"><LoaderCircle className="spin" size={20} />正在读取</div>
              ) : error ? (
                <div className="preview-empty">无法读取本地批次</div>
              ) : page.items.length === 0 ? (
                <div className="preview-empty">没有匹配的笔记</div>
              ) : (
                page.items.map((item) => (
                  <button
                    key={item.sourceId}
                    className={`preview-list-item ${selectedId === item.sourceId ? 'active' : ''}`}
                    onClick={() => setSelectedId(item.sourceId)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.excerpt || '无正文'}</span>
                    <small>
                      {formatDate(item.modifiedAt)}
                      {item.attachmentCount > 0 && <em><Paperclip size={12} />{item.attachmentCount}</em>}
                    </small>
                  </button>
                ))
              )}
            </div>
            <div className="preview-pagination">
              <button
                className="preview-icon-button"
                aria-label="上一页"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
              ><ChevronLeft size={17} /></button>
              <span>{Math.floor(offset / pageSize) + 1} / {Math.max(1, Math.ceil(page.total / pageSize))}</span>
              <button
                className="preview-icon-button"
                aria-label="下一页"
                disabled={offset + pageSize >= page.total}
                onClick={() => setOffset(offset + pageSize)}
              ><ChevronRight size={17} /></button>
            </div>
          </aside>

          <article className="preview-detail">
            {detail ? (
              <>
                <div className="preview-detail-heading">
                  <h3>{detail.title}</h3>
                  <p>创建 {formatDate(detail.createdAt)} · 修改 {formatDate(detail.modifiedAt)}</p>
                </div>
                <PreviewNoteContent
                  api={api}
                  batchId={summary?.batchId ?? ''}
                  detail={detail}
                />
              </>
            ) : (
              <div className="preview-empty">选择一条笔记查看正文</div>
            )}
          </article>
        </div>
      </section>
      {importPickerOpen && (
        <div className="confirm-overlay" role="presentation">
          <section className="confirm-dialog picker-dialog" role="dialog" aria-modal="true" aria-label="选择导入平台">
            <div><h2>选择导入平台</h2><p>将当前小米笔记导入到目标云服务</p></div>
            <div className="picker-options">
              <button className="button secondary" disabled={!vivoAuthenticated || importing} onClick={() => {
                setImporting(true); setImportResult(null);
                void onRequestImport().then((result) => {
                  setImportResult(formatImportReport(result));
                }).catch(() => setImportResult('导入失败，请检查 vivo 登录状态')).finally(() => setImporting(false));
              }}>{importing ? '正在导入' : 'vivo 原子笔记'}</button>
              <button className="button secondary" disabled>小米云笔记（暂未支持）</button>
            </div>
            {importResult && <p className="picker-result">{importResult}</p>}
            <div className="confirm-actions"><button className="button secondary" onClick={() => setImportPickerOpen(false)}>关闭</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

function PreviewNoteContent({
  api,
  batchId,
  detail
}: {
  api: NoteChangeApi;
  batchId: string;
  detail: ExportPreviewDetail;
}) {
  const { segments, unreferenced } = splitInlineAttachments(detail.plainText, detail.attachments);
  return (
    <>
      <div className="preview-note-content" data-testid="preview-note-content">
        {segments.map((segment, index) =>
          segment.type === 'text' ? (
            <div key={`text-${index}`} data-kind="text" className="preview-note-text">
              {segment.value || (segments.length === 1 ? '无正文' : '')}
            </div>
          ) : (
            <div key={segment.attachment.sha256} data-kind="attachment" className="preview-inline-attachment">
              <AttachmentPreview
                api={api}
                batchId={batchId}
                sourceId={detail.sourceId}
                attachment={segment.attachment}
              />
            </div>
          )
        )}
      </div>
      {unreferenced.length > 0 && (
        <div className="preview-attachments">
          <h4><Paperclip size={15} />其他附件</h4>
          {unreferenced.map((attachment) => (
            <AttachmentPreview
              key={attachment.sha256}
              api={api}
              batchId={batchId}
              sourceId={detail.sourceId}
              attachment={attachment}
            />
          ))}
        </div>
      )}
    </>
  );
}

function AttachmentPreview({
  api,
  batchId,
  sourceId,
  attachment
}: {
  api: NoteChangeApi;
  batchId: string;
  sourceId: string;
  attachment: ExportPreviewDetail['attachments'][number];
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSrc(null);
    setFailed(false);
    if (!attachment.mimeType.startsWith('image/')) return () => undefined;
    void api
      .getExportAttachment({ batchId, sourceId, sha256: attachment.sha256 })
      .then((data) => {
        if (active) setSrc(`data:${data.mimeType};base64,${data.base64}`);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [api, attachment.mimeType, attachment.sha256, batchId, sourceId]);
  if (!attachment.mimeType.startsWith('image/')) {
    return <div className="preview-file-attachment"><Paperclip size={14} />{attachment.filename}</div>;
  }
  if (failed) return <div className="preview-image-loading">附件读取失败：{attachment.filename}</div>;
  return src ? <img className="preview-inline-image" src={src} alt={attachment.filename} /> : <div className="preview-image-loading">正在读取图片</div>;
}

function formatDate(value: string | null): string {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatImportReport(report: RendererMigrationReport): string {
  if (report.cancelled) return `导入已取消：新增 ${report.created} 条，跳过 ${report.skipped} 条`;
  if (report.failed > 0) return `导入完成但有失败：新增 ${report.created} 条，失败 ${report.failed} 条，跳过 ${report.skipped} 条`;
  if (report.manualReview > 0) return `导入完成：${report.manualReview} 条笔记未导入；新增 ${report.created} 条，跳过 ${report.skipped} 条`;
  return `导入完成：新增 ${report.created} 条，跳过 ${report.skipped} 条`;
}
