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
  Paperclip,
  ShieldCheck,
  StickyNote,
  Upload
} from 'lucide-react';

import type {
  CloudProvider,
  NoteChangeApi,
  RendererLoginState,
  RendererMigrationReport,
  ScanSummary
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
  const [summary, setSummary] = useState<ScanSummary | LocalExportSummary | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<RendererMigrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      migrationApi.getLoginState('xiaomi'),
      migrationApi.getLoginState('vivo'),
      migrationApi.getLatestExportSummary()
    ])
      .then(([xiaomi, vivo, latestExport]) => {
        if (active) {
          setLogin({ xiaomi, vivo });
          if (latestExport) setSummary(latestExport);
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
      const scanned = await migrationApi.scanXiaomi();
      setSummary((await migrationApi.getLatestExportSummary()) ?? scanned);
    } catch {
      setError('小米笔记导出失败，请检查登录状态后重试。');
    } finally {
      setScanning(false);
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
  const currentStep = report ? 4 : summary ? 3 : xiaomiConnected ? 2 : 1;

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
            <p>{summary ? '小米数据已导出到本地任务，可核对后导入。' : '连接小米账号后即可导出笔记。'}</p>
          </div>
          <button className="button secondary" disabled={!xiaomiConnected || scanning} onClick={() => void scan()}>
            {scanning ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
            {scanning ? '正在导出' : '导出小米笔记'}
          </button>
        </div>

        {summary ? (
          <div className="preview-area">
            <div className="metrics" aria-label="导出统计">
              <Metric icon={<StickyNote size={18} />} label="笔记" value={summary.noteCount} />
              <Metric icon={<Paperclip size={18} />} label="图片附件" value={summary.attachmentCount} />
              <Metric icon={<AlertTriangle size={18} />} label="需处理" value={summary.warningCount} warning />
            </div>

            <div className="preview-command-row">
              <button className="button secondary" onClick={() => setPreviewOpen(true)}>
                <Eye size={17} />
                查看导出内容
              </button>
            </div>

            <div className="confirmation-row">
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
            </div>
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
          summary={'batchId' in (summary ?? {}) ? summary as LocalExportSummary : null}
          onClose={() => setPreviewOpen(false)}
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

function Metric({
  icon,
  label,
  value,
  warning = false
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div className={`metric ${warning ? 'metric-warning' : ''}`}>
      <span className="metric-icon">{icon}</span>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}
