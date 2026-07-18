import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Download,
  Eye,
  LoaderCircle,
  LogIn,
  Trash2,
  Upload
} from 'lucide-react';

import type {
  CloudProvider,
  NoteChangeApi,
  RendererLoginState,
} from '../shared/ipc';
import type { LocalExportSummary } from '../shared/ipc';
import { ExportPreviewDialog } from './ExportPreviewDialog';

export type RendererMigrationApi = NoteChangeApi;

type AppProps = {
  api?: RendererMigrationApi;
};
type LogEntry = { message: string; time: string; kind: 'success' | 'error' | 'info' };

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
  const [login, setLogin] = useState<Record<CloudProvider, RendererLoginState>>({ xiaomi: disconnected, vivo: disconnected });
  const [loadingProvider, setLoadingProvider] = useState<CloudProvider | null>(null);
  const [scanning, setScanning] = useState(false);
  const [exports, setExports] = useState<LocalExportSummary[]>([]);
  const [selectedExport, setSelectedExport] = useState<LocalExportSummary | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LocalExportSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportPickerOpen, setExportPickerOpen] = useState(false);
  const [importPickerOpen, setImportPickerOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([{ message: '应用已启动', time: formatTime(new Date()), kind: 'info' }]);

  const log = (message: string, kind: LogEntry['kind'] = 'info') => setLogs((current) => [{ message, time: formatTime(new Date()), kind }, ...current].slice(0, 6));

  useEffect(() => {
    let active = true;
    void Promise.all([migrationApi.getLoginState('xiaomi'), migrationApi.getLoginState('vivo'), migrationApi.listExports()])
      .then(async ([xiaomi, vivo, localExports]) => {
        if (!active) return;
        setLogin({ xiaomi, vivo });
        setExports(localExports);
        const latest = localExports[0] ?? null;
        if (latest) {
          await migrationApi.selectExport(latest.batchId);
          if (active) setSelectedExport(latest);
        }
        log('已读取登录状态和本地批次');
      })
      .catch(() => { if (active) { setError('无法读取登录状态，请重新连接账号。'); log('读取状态失败'); } });
    return () => { active = false; };
  }, [migrationApi]);

  const connect = async (provider: CloudProvider) => {
    setError(null); setLoadingProvider(provider);
    try {
      if (login[provider].authenticated) {
        await migrationApi.logout?.(provider);
        setLogin((current) => ({ ...current, [provider]: disconnected }));
        log(`${provider === 'xiaomi' ? '小米' : 'vivo'}账号已退出登录`, 'success');
        return;
      }
      const state = await migrationApi.startLogin(provider);
      setLogin((current) => ({ ...current, [provider]: state }));
      log(`${provider === 'xiaomi' ? '小米' : 'vivo'}账号登录成功`);
    } catch {
      setError('账号登录未完成，请在打开的登录窗口中完成验证。'); log(`${provider === 'xiaomi' ? '小米' : 'vivo'}账号登录失败`);
    } finally { setLoadingProvider(null); }
  };

  const scan = async () => {
    setError(null); setScanning(true);
    try {
      await migrationApi.scanXiaomi();
      const localExports = await migrationApi.listExports();
      setExports(localExports); setSelectedExport(localExports[0] ?? null);
      log('小米笔记导出成功', 'success'); setExportPickerOpen(false);
    } catch {
      setError('小米笔记导出失败，请检查登录状态后重试。'); log('小米笔记导出失败', 'error');
    } finally { setScanning(false); }
  };

  const openPreview = async (summary: LocalExportSummary) => {
    setError(null);
    try {
      const selected = await migrationApi.selectExport(summary.batchId);
      setSelectedExport(selected); setPreviewOpen(true); log(`打开查看：${summary.batchId}`);
    } catch { setError('无法读取所选本地批次。'); log('打开批次失败'); }
  };

  const openImport = async (summary: LocalExportSummary) => {
    setError(null);
    try {
      const selected = await migrationApi.selectExport(summary.batchId);
      setSelectedExport(selected);
      setImportPickerOpen(true);
      log(`选择导入批次：${summary.batchId}`);
    } catch {
      setError('无法读取所选本地批次。');
      log('打开导入失败', 'error');
    }
  };

  const deleteExport = async () => {
    if (!deleteTarget) return;
    setError(null); setDeleting(true);
    try {
      await migrationApi.deleteExport(deleteTarget.batchId);
      const remaining = await migrationApi.listExports();
      setExports(remaining);
      if (selectedExport?.batchId === deleteTarget.batchId) { setSelectedExport(null); setPreviewOpen(false); }
      setDeleteTarget(null); log(`已删除批次 ${deleteTarget.batchId}`);
    } catch { setError('本地批次删除失败，请确认文件未被其他程序占用。'); log('删除批次失败'); }
    finally { setDeleting(false); }
  };

  const xiaomiConnected = login.xiaomi.authenticated;
  const importToVivo = async () => {
    setError(null);
    setImporting(true);
    try {
      await migrationApi.confirmMigration();
      const report = await migrationApi.startImport();
      if (report.cancelled) log('导入已取消');
      else if (report.failed > 0) { log(`导入完成但有失败：${report.failed} 条`, 'error'); setError(`导入完成但有 ${report.failed} 条失败。`); }
      else if (report.manualReview > 0) log(`导入完成：${report.manualReview} 条笔记未导入`, 'info');
      else log(`导入成功：新增 ${report.created} 条`, 'success');
      setImportPickerOpen(false);
      return report;
    } catch (cause) {
      log('导入失败', 'error');
      setError('导入失败，请检查 vivo 登录状态后重试。');
      throw cause;
    } finally { setImporting(false); }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><Cloud size={20} /></div>
        <div><h1>笔记迁移</h1><p>小米云笔记与 vivo 原子笔记</p></div>
        <section className="operation-log" aria-label="最近操作">
          <strong>最近操作</strong>
          <div className="operation-log-list" role="log" aria-live="polite">{logs.map((entry, index) => <span className={`log-entry log-${entry.kind}`} key={`${entry.time}-${index}`}><time>{entry.time}</time>{entry.message}</span>)}</div>
        </section>
      </header>

      <section className="workspace" aria-label="云账号登录">
        <ProviderPanel provider="xiaomi" name="小米云笔记" state={login.xiaomi} loading={loadingProvider === 'xiaomi'} onConnect={() => void connect('xiaomi')} />
        <ProviderPanel provider="vivo" name="vivo 原子笔记" state={login.vivo} loading={loadingProvider === 'vivo'} onConnect={() => void connect('vivo')} />
      </section>

      {error && <div className="error-banner" role="alert"><AlertTriangle size={17} />{error}</div>}

      <section className="migration-section">
        <div className="section-heading">
          <div><h2>导出笔记</h2><p>{exports.length ? '本地保存的导出批次' : '登录后选择要导出的云平台'}</p></div>
          <button className="button primary" disabled={scanning} onClick={() => setExportPickerOpen(true)}>
            {scanning ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}{scanning ? '正在导出' : '导出笔记'}
          </button>
        </div>

        {exports.length ? <div className="preview-area">
          <table className="export-table" aria-label="本地导出批次">
            <thead><tr><th>来源</th><th>导出时间</th><th>笔记</th><th>附件</th><th>操作</th></tr></thead>
            <tbody>{exports.map((summary) => <tr key={summary.batchId} className={selectedExport?.batchId === summary.batchId ? 'selected' : ''}>
              <td data-label="来源">小米云笔记</td><td data-label="导出时间">{formatDate(summary.exportedAt)}</td><td data-label="笔记">{summary.noteCount}</td><td data-label="附件">{summary.attachmentCount}</td>
              <td data-label="操作"><div className="export-actions"><button className="button compact primary" onClick={() => void openImport(summary)}><Upload size={15} />导入</button><button className="button compact secondary" onClick={() => void openPreview(summary)}><Eye size={15} />查看</button><button className="button compact danger" aria-label={`删除批次 ${summary.batchId}`} onClick={() => setDeleteTarget(summary)}><Trash2 size={15} />删除</button></div></td>
            </tr>)}</tbody>
          </table>
        </div> : <div className="empty-state"><Download size={22} /><span>尚未生成导出批次</span></div>}
      </section>

      {previewOpen && selectedExport && <ExportPreviewDialog api={migrationApi} summary={selectedExport} onClose={() => setPreviewOpen(false)} />}
      {deleteTarget && <DeleteExportDialog summary={deleteTarget} deleting={deleting} onCancel={() => !deleting && setDeleteTarget(null)} onConfirm={() => void deleteExport()} />}
      {exportPickerOpen && <ExportPickerDialog xiaomiConnected={xiaomiConnected} scanning={scanning} onCancel={() => setExportPickerOpen(false)} onExportXiaomi={() => void scan()} />}
      {importPickerOpen && <ImportPickerDialog vivoConnected={login.vivo.authenticated} importing={importing} onCancel={() => !importing && setImportPickerOpen(false)} onImport={() => void importToVivo()} />}
    </main>
  );
}

function ExportPickerDialog({ xiaomiConnected, scanning, onCancel, onExportXiaomi }: { xiaomiConnected: boolean; scanning: boolean; onCancel: () => void; onExportXiaomi: () => void }) {
  return <div className="confirm-overlay" role="presentation"><section className="confirm-dialog picker-dialog" role="dialog" aria-modal="true" aria-label="选择导出平台">
    <div><h2>选择导出平台</h2><p>选择要保存到本地的云笔记</p></div>
    <div className="picker-options"><button className="button secondary" disabled={!xiaomiConnected || scanning} onClick={onExportXiaomi}>{scanning ? '正在导出' : '小米云笔记'}</button><button className="button secondary" disabled>vivo 原子笔记（暂未支持）</button></div>
    <div className="confirm-actions"><button className="button secondary" onClick={onCancel}>取消</button></div>
  </section></div>;
}

function ImportPickerDialog({ vivoConnected, importing, onCancel, onImport }: { vivoConnected: boolean; importing: boolean; onCancel: () => void; onImport: () => void }) {
  return <div className="confirm-overlay" role="presentation"><section className="confirm-dialog picker-dialog" role="dialog" aria-modal="true" aria-label="选择导入平台">
    <div><h2>选择导入平台</h2><p>将当前批次导入到目标云服务</p></div>
    <div className="picker-options"><button className="button secondary" disabled={!vivoConnected || importing} onClick={onImport}>{importing ? '正在导入' : '导入到 vivo 原子笔记'}</button><button className="button secondary" disabled>导入到小米云笔记（暂未支持）</button></div>
    {!vivoConnected && <p className="picker-result">请先登录 vivo 原子笔记</p>}
    <div className="confirm-actions"><button className="button secondary" disabled={importing} onClick={onCancel}>取消</button></div>
  </section></div>;
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
      <div className="provider-status">
        {state.authenticated && <span className="connected"><CheckCircle2 size={16} />已登录</span>}
        <button className="button compact secondary login-button" onClick={onConnect} title={`${state.authenticated ? '退出登录' : '登录'}${name}`} aria-label={`${state.authenticated ? '退出登录' : '登录'}${name}`}>
          {loading ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />}{state.authenticated ? '退出登录' : '登录'}
        </button>
      </div>
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

function formatTime(value: Date): string {
  return value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
