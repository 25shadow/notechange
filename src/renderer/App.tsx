import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Cloud,
  Download,
  Eye,
  LoaderCircle,
  LogIn,
  ShieldCheck,
  Trash2,
  Upload
} from 'lucide-react';

import type {
  CloudProvider,
  NoteChangeApi,
  RendererLoginState,
  RendererMigrationReport
} from '../shared/ipc';
import type { LocalExportSummary } from '../shared/ipc';
import { ExportPreviewDialog } from './ExportPreviewDialog';

export type RendererMigrationApi = NoteChangeApi;

type AppProps = {
  api?: RendererMigrationApi;
};

const disconnected: RendererLoginState = { authenticated: false, accountLabel: null };
const unavailableApi: RendererMigrationApi = {
  getLoginState: async () => disconnected,
  startLogin: async () => {
    throw new Error('IPC_UNAVAILABLE');
  },
  scanXiaomi: async () => {
    throw new Error('IPC_UNAVAILABLE');
  },
  getLatestExportSummary: async () => null,
  listExports: async () => [],
  selectExport: async () => {
    throw new Error('IPC_UNAVAILABLE');
  },
  deleteExport: async () => {
    throw new Error('IPC_UNAVAILABLE');
  },
  getExportPreview: async () => ({ total: 0, items: [] }),
  getExportPreviewDetail: async () => {
    throw new Error('IPC_UNAVAILABLE');
  },
  getExportAttachment: async () => {
    throw new Error('IPC_UNAVAILABLE');
  },
  confirmMigration: async () => {
    throw new Error('IPC_UNAVAILABLE');
  },
  startImport: async () => {
    throw new Error('IPC_UNAVAILABLE');
  },
  cancelMigration: async () => {
    throw new Error('IPC_UNAVAILABLE');
  }
};

export function App({ api }: AppProps) {
  const migrationApi = api ?? window.notechange ?? unavailableApi;
  const [login, setLogin] = useState<Record<CloudProvider, RendererLoginState>>({
    xiaomi: disconnected,
    vivo: disconnected
  });
  const [loadingProvider, setLoadingProvider] = useState<CloudProvider | null>(null);
  const [scanning, setScanning] = useState(false);
  const [exports, setExports] = useState<LocalExportSummary[]>([]);
  const [selectedExport, setSelectedExport] = useState<LocalExportSummary | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LocalExportSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<RendererMigrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      migrationApi.getLoginState('xiaomi'),
      migrationApi.getLoginState('vivo'),
      migrationApi.listExports()
    ])
      .then(async ([xiaomi, vivo, localExports]) => {
        if (active) {
          setLogin({ xiaomi, vivo });
          setExports(localExports);
          const latest = localExports[0] ?? null;
          if (latest) {
            await migrationApi.selectExport(latest.batchId);
            if (active) setSelectedExport(latest);
          }
        }
      })
      .catch(() => {
        if (active) setError('无法读取登录状态，请重新连接账号。');
      });
    return () => {
      active = false;
    };
  }, [migrationApi]);

  const connect = async (provider: CloudProvider) => {
    setError(null);
    setLoadingProvider(provider);
    try {
      const state = await migrationApi.startLogin(provider);
      setLogin((current) => ({ ...current, [provider]: state }));
    } catch {
      setError('账号连接未完成，请在打开的登录窗口中完成验证。');
    } finally {
      setLoadingProvider(null);
    }
  };

  const scan = async () => {
    setError(null);
    setScanning(true);
    setConfirmed(false);
    setReport(null);
    try {
      await migrationApi.scanXiaomi();
      const localExports = await migrationApi.listExports();
      setExports(localExports);
      setSelectedExport(localExports[0] ?? null);
    } catch {
      setError('小米笔记导出失败，请检查登录状态后重试。');
    } finally {
      setScanning(false);
    }
  };

  const openPreview = async (summary: LocalExportSummary) => {
    setError(null);
    try {
      const selected = await migrationApi.selectExport(summary.batchId);
      setSelectedExport(selected);
      setConfirmed(false);
      setReport(null);
      setPreviewOpen(true);
    } catch {
      setError('无法读取所选本地批次。');
    }
  };

  const deleteExport = async () => {
    if (!deleteTarget) return;
    setError(null);
    setDeleting(true);
    try {
      await migrationApi.deleteExport(deleteTarget.batchId);
      const remaining = await migrationApi.listExports();
      setExports(remaining);
      if (selectedExport?.batchId === deleteTarget.batchId) {
        setSelectedExport(null);
        setConfirmed(false);
        setReport(null);
        setPreviewOpen(false);
      }
      setDeleteTarget(null);
    } catch {
      setError('本地批次删除失败，请确认文件未被其他程序占用。');
    } finally {
      setDeleting(false);
    }
  };

  const startImport = async () => {
    setError(null);
    setImporting(true);
    try {
      await migrationApi.confirmMigration();
      setReport(await migrationApi.startImport());
    } catch {
      setError('vivo 导入未完成，已保存检查点，可稍后继续。');
    } finally {
      setImporting(false);
    }
  };

  const xiaomiConnected = login.xiaomi.authenticated;
  const vivoConnected = login.vivo.authenticated;
  const currentStep = report ? 4 : selectedExport ? 3 : xiaomiConnected ? 2 : 1;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <Cloud size={20} />
        </div>
        <div>
          <h1>笔记迁移</h1>
          <p>小米云笔记 → vivo 原子笔记</p>
        </div>
        <div className="privacy-status">
          <ShieldCheck size={16} />
          本地处理
        </div>
      </header>

      <nav className="stepbar" aria-label="迁移进度">
        {['连接账号', '导出小米', '核对预览', '导入 vivo'].map((label, index) => {
          const step = index + 1;
          const complete = step < currentStep;
          return (
            <div className={`step ${step <= currentStep ? 'active' : ''}`} key={label}>
              <span>{complete ? <Check size={14} /> : step}</span>
              {label}
            </div>
          );
        })}
      </nav>

      <section className="workspace" aria-label="云账号连接">
        <ProviderPanel
          provider="xiaomi"
          name="小米云笔记"
          state={login.xiaomi}
          loading={loadingProvider === 'xiaomi'}
          onConnect={() => void connect('xiaomi')}
        />

        <div className="transfer-rail" aria-hidden="true">
          <div className="rail-line" />
          <div className="rail-vault">
            <ShieldCheck size={18} />
          </div>
          <ArrowRight size={18} />
        </div>

        <ProviderPanel
          provider="vivo"
          name="vivo 原子笔记"
          state={login.vivo}
          loading={loadingProvider === 'vivo'}
          onConnect={() => void connect('vivo')}
        />
      </section>

      {error && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={17} />
          {error}
        </div>
      )}

      <section className="migration-section">
        <div className="section-heading">
          <div>
            <h2>迁移批次</h2>
            <p>{exports.length ? '选择一个本地批次查看、删除或导入。' : '连接小米账号后即可导出笔记。'}</p>
          </div>
          <button className="button secondary" disabled={!xiaomiConnected || scanning} onClick={() => void scan()}>
            {scanning ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
            {scanning ? '正在导出' : '导出小米笔记'}
          </button>
        </div>

        {exports.length ? (
          <div className="preview-area">
            <table className="export-table" aria-label="本地导出批次">
              <thead><tr><th>导出时间</th><th>笔记</th><th>附件</th><th>需处理</th><th>操作</th></tr></thead>
              <tbody>
                {exports.map((summary) => (
                  <tr key={summary.batchId} className={selectedExport?.batchId === summary.batchId ? 'selected' : ''}>
                    <td data-label="导出时间">{formatDate(summary.exportedAt)}</td>
                    <td data-label="笔记">{summary.noteCount}</td>
                    <td data-label="附件">{summary.attachmentCount}</td>
                    <td data-label="需处理" className={summary.warningCount ? 'warning-count' : ''}>{summary.warningCount}</td>
                    <td data-label="操作">
                      <div className="export-actions">
                        <button className="button compact secondary" onClick={() => void openPreview(summary)}>
                          <Eye size={15} />查看
                        </button>
                        <button className="button compact danger" aria-label={`删除批次 ${summary.batchId}`} onClick={() => setDeleteTarget(summary)}>
                          <Trash2 size={15} />删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {selectedExport ? <><div className="confirmation-row">
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span className="custom-check" aria-hidden="true"><Check size={13} /></span>
                我已核对目标账号和迁移数量
              </label>
              <span>来源笔记不会被修改或删除</span>
            </div>

            <div className="action-row">
              {report && (
                <div className="report-summary" role="status">
                  <CheckCircle2 size={18} />
                  已创建 {report.created} 条
                  <span>跳过 {report.skipped} · 人工处理 {report.manualReview}</span>
                </div>
              )}
              <button
                className="button primary"
                disabled={!confirmed || !vivoConnected || importing}
                onClick={() => void startImport()}
              >
                {importing ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}
                {importing ? '正在导入' : '导入 vivo'}
              </button>
            </div></> : <div className="batch-selection-hint">选择“查看”后可核对并导入该批次</div>}
          </div>
        ) : (
          <div className="empty-state">
            <Download size={22} />
            <span>尚未生成导出批次</span>
          </div>
        )}
      </section>
      {previewOpen && (
        <ExportPreviewDialog
          api={migrationApi}
          summary={selectedExport}
          onClose={() => setPreviewOpen(false)}
        />
      )}
      {deleteTarget && (
        <DeleteExportDialog
          summary={deleteTarget}
          deleting={deleting}
          onCancel={() => !deleting && setDeleteTarget(null)}
          onConfirm={() => void deleteExport()}
        />
      )}
    </main>
  );
}

function ProviderPanel({
  provider,
  name,
  state,
  loading,
  onConnect
}: {
  provider: CloudProvider;
  name: string;
  state: RendererLoginState;
  loading: boolean;
  onConnect: () => void;
}) {
  return (
    <article className={`provider provider-${provider}`}>
      <div className="provider-logo" aria-hidden="true">{provider === 'xiaomi' ? 'MI' : 'V'}</div>
      <div className="provider-copy">
        <h2>{name}</h2>
        <p>{state.accountLabel ?? (state.authenticated ? '后台会话' : '当前浏览器会话')}</p>
      </div>
      {state.authenticated ? (
        <span className="connected"><CheckCircle2 size={16} />已连接</span>
      ) : (
        <button className="icon-command" onClick={onConnect} title={`连接${name}`} aria-label={`连接${name}`}>
          {loading ? <LoaderCircle className="spin" size={18} /> : <LogIn size={18} />}
        </button>
      )}
    </article>
  );
}

function DeleteExportDialog({
  summary,
  deleting,
  onCancel,
  onConfirm
}: {
  summary: LocalExportSummary;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [deleting, onCancel]);

  return (
    <div className="confirm-overlay" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-label="删除本地导出批次">
        <div className="confirm-danger-icon"><Trash2 size={20} /></div>
        <div>
          <h2>删除这个本地批次？</h2>
          <p>{formatDate(summary.exportedAt)} · {summary.noteCount} 条笔记 · {summary.attachmentCount} 个附件</p>
        </div>
        <div className="confirm-warning">只会删除 NoteChange 本地保存的这批导出文件，不会删除小米云端笔记或 vivo 笔记。</div>
        <div className="confirm-actions">
          <button className="button secondary" disabled={deleting} onClick={onCancel}>取消</button>
          <button className="button danger solid" disabled={deleting} onClick={onConfirm}>
            {deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
            {deleting ? '正在删除' : '删除本地批次'}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value));
}
