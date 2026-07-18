import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Cloud,
  Download,
  Eye,
  FolderOpen,
  LoaderCircle,
  LogIn,
  KeyRound,
  Trash2,
  Upload
} from 'lucide-react';

import type {
  CloudProvider,
  NoteChangeApi,
  RendererLoginState,
  ImportHistoryTask,
  ImportProgress,
  ExportProgress
} from '../shared/ipc';
import type { LicenseStatus } from '../shared/ipc';
import type { UpdateStatus } from '../shared/ipc';
import type { LocalExportSummary } from '../shared/ipc';
import { ExportPreviewDialog } from './ExportPreviewDialog';
import { ImportHistoryDialog } from './ImportHistoryDialog';

export type RendererMigrationApi = NoteChangeApi;

type AppProps = {
  api?: RendererMigrationApi;
};
type LogEntry = { message: string; time: string; kind: 'success' | 'error' | 'info' };

const disconnected: RendererLoginState = { authenticated: false, accountLabel: null };
const activeLicense: LicenseStatus = { state: 'active', licenseId: null, message: '永久授权已激活' };
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
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [importHistory, setImportHistory] = useState<ImportHistoryTask[]>([]);
  const [historyDetail, setHistoryDetail] = useState<ImportHistoryTask | null>(null);
  const [openingNoteCenter, setOpeningNoteCenter] = useState<CloudProvider | null>(null);
  const [license, setLicense] = useState<LicenseStatus>(activeLicense);
  const [licenseDialogOpen, setLicenseDialogOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'unavailable', version: null, progress: null, message: '当前版本未配置更新服务' });
  const [logs, setLogs] = useState<LogEntry[]>([{ message: '应用已启动', time: formatTime(new Date()), kind: 'info' }]);

  const log = (message: string, kind: LogEntry['kind'] = 'info') => setLogs((current) => [{ message, time: formatTime(new Date()), kind }, ...current].slice(0, 6));

  useEffect(() => {
    let active = true;
    void Promise.all([migrationApi.getLoginState('xiaomi'), migrationApi.getLoginState('vivo'), migrationApi.listExports(), migrationApi.listImportHistory?.() ?? Promise.resolve([])])
      .then(async ([xiaomi, vivo, localExports, tasks]) => {
        if (!active) return;
        setLogin({ xiaomi, vivo });
        setExports(localExports);
        setImportHistory(tasks);
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

  useEffect(() => { if (migrationApi.getUpdateStatus) void migrationApi.getUpdateStatus().then(setUpdate); }, [migrationApi]);

  useEffect(() => {
    if (!migrationApi.getLicenseStatus) return;
    void migrationApi.getLicenseStatus().then((status) => {
      setLicense(status);
      if (status.state !== 'active') setLicenseDialogOpen(true);
    }).catch(() => setLicense({ state: 'inactive', licenseId: null, message: '无法验证授权状态' }));
  }, [migrationApi]);

  useEffect(() => {
    const unsubscribe = migrationApi.onExportProgress?.((progress) => {
      setExportProgress(progress);
      if (progress.stage === 'listing') log('正在读取笔记列表');
      if (progress.stage === 'exporting' && progress.current) log(`已导出：${progress.current.title}`, 'success');
      if (progress.stage === 'failed') log(`导出失败：${progress.errorCode ?? 'UNKNOWN'}`, 'error');
    });
    return () => unsubscribe?.();
  }, [migrationApi]);

  useEffect(() => {
    const unsubscribe = migrationApi.onImportProgress?.((progress) => {
      setImportProgress(progress);
      setImporting(true);
      if (progress.current) log(`正在导入：${progress.current.title}`);
    });
    return () => unsubscribe?.();
  }, [migrationApi]);

  const refreshImportHistory = async () => {
    if (!migrationApi.listImportHistory) return;
    setImportHistory(await migrationApi.listImportHistory());
  };

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

  const licenseActive = license.state === 'active';

  const scan = async (provider: CloudProvider) => {
    const providerName = provider === 'xiaomi' ? '小米笔记' : 'vivo 笔记';
    setError(null); setExportProgress({ source: provider, total: 0, completed: 0, stage: 'listing', current: null, occurredAt: new Date().toISOString() }); setScanning(true);
    try {
      if (provider === 'xiaomi') await migrationApi.scanXiaomi();
      else if (migrationApi.scanVivo) await migrationApi.scanVivo();
      else throw new Error('VIVO_EXPORT_UNAVAILABLE');
      const localExports = await migrationApi.listExports();
      setExports(localExports); setSelectedExport(localExports[0] ?? null);
      log(`${providerName}导出成功`, 'success'); setExportPickerOpen(false);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'UNKNOWN';
      setError(`${providerName}导出失败：${code}`); log(`${providerName}导出失败：${code}`, 'error');
    } finally { setScanning(false); setExportProgress(null); }
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

  const sourceProvider = selectedExport?.source ?? 'xiaomi';
  const targetProvider: CloudProvider = sourceProvider === 'xiaomi' ? 'vivo' : 'xiaomi';
  const importToVivo = async () => {
    setError(null);
    setImporting(true);
    setImportProgress(null);
    try {
      await migrationApi.confirmMigration();
      const report = await migrationApi.startImport();
      if (report.cancelled) log('导入已取消');
      else if (report.failed > 0) { log(`导入完成但有失败：${report.failed} 条`, 'error'); setError(`导入完成但有 ${report.failed} 条失败。`); }
      else if (report.manualReview > 0) log(`导入完成：${report.manualReview} 条笔记未导入`, 'info');
      else log(`导入成功：新增 ${report.created} 条`, 'success');
      setImportPickerOpen(false);
      await refreshImportHistory();
      return report;
    } catch (cause) {
      log('导入失败', 'error');
      setError(`导入失败，请检查${targetProvider === 'vivo' ? 'vivo 原子笔记' : '小米云笔记'}登录状态后重试。`);
      throw cause;
    } finally { setImporting(false); setImportProgress(null); }
  };

  const openHistoryDetail = async (taskId: string) => {
    try {
      const task = await migrationApi.getImportHistory?.(taskId);
      if (task) setHistoryDetail(task);
    } catch { setError('无法读取导入历史详情。'); }
  };

  const openNoteCenter = async (provider: CloudProvider) => {
    const providerName = provider === 'xiaomi' ? '小米云笔记' : 'vivo 原子笔记';
    if (!migrationApi.openNoteCenter) {
      setError('当前应用版本不支持打开笔记中心。');
      log(`打开${providerName}笔记中心失败`, 'error');
      return;
    }
    setOpeningNoteCenter(provider);
    try {
      await migrationApi.openNoteCenter(provider);
      log(`已打开${providerName}笔记中心`, 'success');
    } catch {
      setError('无法打开笔记中心。');
      log(`打开${providerName}笔记中心失败`, 'error');
    }
    finally { setOpeningNoteCenter(null); }
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
        <ProviderPanel provider="xiaomi" name="小米云笔记" state={login.xiaomi} loading={loadingProvider === 'xiaomi'} openingNoteCenter={openingNoteCenter === 'xiaomi'} onConnect={() => void connect('xiaomi')} onOpenNoteCenter={() => void openNoteCenter('xiaomi')} />
        <ProviderPanel provider="vivo" name="vivo 原子笔记" state={login.vivo} loading={loadingProvider === 'vivo'} openingNoteCenter={openingNoteCenter === 'vivo'} onConnect={() => void connect('vivo')} onOpenNoteCenter={() => void openNoteCenter('vivo')} />
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
              <td data-label="来源">{providerName(summary.source ?? 'xiaomi')}</td><td data-label="导出时间">{formatDate(summary.exportedAt)}</td><td data-label="笔记">{summary.noteCount}</td><td data-label="附件">{summary.attachmentCount}</td>
              <td data-label="操作"><div className="export-actions"><button className="button compact primary" disabled={!licenseActive} onClick={() => void openImport(summary)}><Upload size={15} />导入</button><button className="button compact secondary" onClick={() => void openPreview(summary)}><Eye size={15} />查看</button><button className="button compact danger" aria-label={`删除批次 ${summary.batchId}`} onClick={() => setDeleteTarget(summary)}><Trash2 size={15} />删除</button></div></td>
            </tr>)}</tbody>
          </table>
        </div> : <div className="empty-state"><Download size={22} /><span>尚未生成导出批次</span></div>}
      </section>

      <section className="migration-section history-section" aria-label="导入历史">
        <div className="section-heading"><div><h2>导入历史</h2><p>{importHistory.length ? '本机保存的导入任务记录' : '尚无已保存的导入任务记录'}</p></div></div>
        {importHistory.length ? <div className="preview-area"><table className="export-table history-table"><thead><tr><th>导入时间</th><th>状态</th><th>新增</th><th>问题</th><th>操作</th></tr></thead><tbody>{importHistory.map((task) => <tr key={task.taskId}><td data-label="导入时间">{formatDate(task.startedAt)}</td><td data-label="状态">{historyStatusLabel(task.status)}</td><td data-label="新增">{task.progress.created}</td><td data-label="问题">{task.progress.failed + task.progress.manualReview}</td><td data-label="操作"><button className="button compact secondary" aria-label={`查看导入详情 ${task.taskId}`} onClick={() => void openHistoryDetail(task.taskId)}><Eye size={15} />详情</button></td></tr>)}</tbody></table></div> : <div className="empty-state history-empty-state"><Clock3Icon /><span>尚无导入历史</span></div>}
      </section>

      {previewOpen && selectedExport && <ExportPreviewDialog api={migrationApi} summary={selectedExport} onClose={() => setPreviewOpen(false)} />}
      {deleteTarget && <DeleteExportDialog summary={deleteTarget} deleting={deleting} onCancel={() => !deleting && setDeleteTarget(null)} onConfirm={() => void deleteExport()} />}
      {exportPickerOpen && <ExportPickerDialog xiaomiConnected={login.xiaomi.authenticated} vivoConnected={login.vivo.authenticated} vivoExportAvailable={Boolean(migrationApi.scanVivo)} licenseActive={licenseActive} scanning={scanning} onCancel={() => setExportPickerOpen(false)} onExportXiaomi={() => void scan('xiaomi')} onExportVivo={() => void scan('vivo')} />}
      {importPickerOpen && <ImportPickerDialog targetProvider={targetProvider} targetConnected={login[targetProvider].authenticated} importing={importing} onCancel={() => !importing && setImportPickerOpen(false)} onImport={() => void importToVivo()} />}
      {importProgress && <ImportProgressDialog progress={importProgress} logs={logs} onCancel={() => void migrationApi.cancelMigration()} />}
      {exportProgress && <ExportProgressDialog progress={exportProgress} logs={logs} />}
      {historyDetail && <ImportHistoryDialog task={historyDetail} onClose={() => setHistoryDetail(null)} />}
      <button className="license-status" onClick={() => setLicenseDialogOpen(true)} title="永久授权"><KeyRound size={15} />{license.state === 'active' ? '永久授权已激活' : '激活永久授权'}</button>
      <button className="update-status" disabled={!migrationApi.checkForUpdates || update.state === 'checking' || update.state === 'downloading'} onClick={() => {
        if (update.state === 'available') void migrationApi.downloadUpdate?.().then(setUpdate);
        else if (update.state === 'downloaded') void migrationApi.installUpdate?.();
        else void migrationApi.checkForUpdates?.().then(setUpdate);
      }} title={update.message}>{update.state === 'available' ? `下载 ${update.version}` : update.state === 'downloaded' ? '重启并安装更新' : update.state === 'downloading' ? update.message : '检查更新'}</button>
      {licenseDialogOpen && <LicenseDialog api={migrationApi} status={license} onStatus={setLicense} onClose={() => setLicenseDialogOpen(false)} />}
    </main>
  );
}

function ExportPickerDialog({ xiaomiConnected, vivoConnected, vivoExportAvailable, licenseActive, scanning, onCancel, onExportXiaomi, onExportVivo }: { xiaomiConnected: boolean; vivoConnected: boolean; vivoExportAvailable: boolean; licenseActive: boolean; scanning: boolean; onCancel: () => void; onExportXiaomi: () => void; onExportVivo: () => void }) {
  return <div className="confirm-overlay" role="presentation"><section className="confirm-dialog picker-dialog" role="dialog" aria-modal="true" aria-label="选择导出平台">
    <div><h2>选择导出平台</h2><p>选择要保存到本地的云笔记</p></div>
    <div className="picker-options"><button className="button secondary" disabled={!licenseActive || !xiaomiConnected || scanning} onClick={onExportXiaomi}>{scanning ? '正在导出' : '小米云笔记'}</button><button className="button secondary" disabled={!licenseActive || !vivoConnected || !vivoExportAvailable || scanning} onClick={onExportVivo}>{scanning ? '正在导出' : 'vivo 原子笔记'}</button></div>
    <div className="confirm-actions"><button className="button secondary" onClick={onCancel}>取消</button></div>
  </section></div>;
}

function LicenseDialog({ api, status, onStatus, onClose }: { api: RendererMigrationApi; status: LicenseStatus; onStatus: (status: LicenseStatus) => void; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activate = async () => {
    if (!api.activateLicense) return;
    setBusy(true); setError(null);
    try { const next = await api.activateLicense(code); onStatus(next); onClose(); }
    catch (cause) { setError(cause instanceof Error ? licenseError(cause.message) : '激活失败'); }
    finally { setBusy(false); }
  };
  return <div className="confirm-overlay" role="presentation"><section className="confirm-dialog picker-dialog" role="dialog" aria-modal="true" aria-label="永久授权">
    <div><h2>永久授权</h2><p>{status.message}</p></div>
    {status.state === 'active' ? <div className="confirm-actions"><button className="button secondary" disabled={busy} onClick={() => { if (api.deactivateLicense) void api.deactivateLicense().then(onStatus); }}>解绑当前设备</button><button className="button primary" onClick={onClose}>完成</button></div> : <><input className="license-code-input" aria-label="永久激活码" placeholder="NC-XXXX-XXXX-XXXX-XXXX-XXXX" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /><p className="picker-result">{error ?? (status.state === 'unconfigured' ? '请先在应用构建配置中设置授权服务地址和公钥。' : '激活码永久有效，仅绑定当前设备。')}</p><div className="confirm-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={busy || status.state === 'unconfigured' || !code} onClick={() => void activate()}>{busy ? '正在激活' : '激活'}</button></div></>}
  </section></div>;
}

function licenseError(code: string): string { return ({ LICENSE_CODE_INVALID: '激活码格式不正确', LICENSE_REVOKED: '该激活码已被禁用', LICENSE_DEVICE_LIMIT_REACHED: '该激活码已绑定其他设备', LICENSE_SERVICE_UNCONFIGURED: '授权服务尚未配置' } as Record<string, string>)[code] ?? '激活失败，请稍后重试'; }

function ImportPickerDialog({ targetProvider, targetConnected, importing, onCancel, onImport }: { targetProvider: CloudProvider; targetConnected: boolean; importing: boolean; onCancel: () => void; onImport: () => void }) {
  const targetName = providerName(targetProvider);
  return <div className="confirm-overlay" role="presentation"><section className="confirm-dialog picker-dialog" role="dialog" aria-modal="true" aria-label="选择导入平台">
    <div><h2>选择导入平台</h2><p>将当前批次导入到目标云服务</p></div>
    <div className="picker-options"><button className="button secondary" disabled={!targetConnected || importing} onClick={onImport}>{importing ? '正在导入' : `导入到 ${targetName}`}</button></div>
    {!targetConnected && <p className="picker-result">请先登录 {targetName}</p>}
    <div className="confirm-actions"><button className="button secondary" disabled={importing} onClick={onCancel}>取消</button></div>
  </section></div>;
}

function ProviderPanel({
  provider,
  name,
  state,
  loading,
  openingNoteCenter,
  onConnect,
  onOpenNoteCenter
}: {
  provider: CloudProvider;
  name: string;
  state: RendererLoginState;
  loading: boolean;
  openingNoteCenter: boolean;
  onConnect: () => void;
  onOpenNoteCenter: () => void;
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
        {state.authenticated && <button className="button compact secondary note-center-button" disabled={openingNoteCenter} onClick={onOpenNoteCenter} title="打开笔记中心" aria-label="打开笔记中心">{openingNoteCenter ? <LoaderCircle className="spin" size={16} /> : <FolderOpen size={16} />}打开笔记中心</button>}
        <button className="button compact secondary login-button" onClick={onConnect} title={`${state.authenticated ? '退出登录' : '登录'}${name}`} aria-label={`${state.authenticated ? '退出登录' : '登录'}${name}`}>
          {loading ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />}{state.authenticated ? '退出登录' : '登录'}
        </button>
      </div>
    </article>
  );
}

function ImportProgressDialog({ progress, logs, onCancel }: { progress: ImportProgress; logs: LogEntry[]; onCancel: () => void }) {
  const percentage = progress.total ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;
  return <div className="confirm-overlay" role="presentation"><section className="confirm-dialog import-progress-dialog" role="dialog" aria-modal="true" aria-label="正在导入笔记">
    <div><h2>正在导入笔记</h2><p>{progress.current?.title ?? '正在准备导入任务'}</p></div>
    <div className="progress-stats"><strong>{progress.completed} / {progress.total}</strong><span>新增 {progress.created} · 跳过 {progress.skipped} · 失败 {progress.failed} · 核对 {progress.manualReview}</span></div>
    <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}><span style={{ width: `${percentage}%` }} /></div>
    <div className="progress-log" aria-label="最近导入日志">{logs.slice(0, 3).map((entry, index) => <span key={`${entry.time}-${index}`}>{entry.message}</span>)}</div>
    <div className="confirm-actions"><button className="button danger" onClick={onCancel}>取消导入</button></div>
  </section></div>;
}

function ExportProgressDialog({ progress, logs }: { progress: ExportProgress; logs: LogEntry[] }) {
  const percentage = progress.total ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;
  const title = progress.stage === 'listing' ? '正在读取笔记列表' : progress.stage === 'failed' ? '导出失败' : progress.stage === 'completed' ? '导出完成' : `正在导出：${progress.current?.title ?? '笔记'}`;
  return <div className="confirm-overlay" role="presentation"><section className="confirm-dialog import-progress-dialog" role="dialog" aria-modal="true" aria-label="正在导出笔记">
    <div><h2>正在导出笔记</h2><p>{title}</p></div>
    <div className="progress-stats"><strong>{progress.completed} / {progress.total || '?'}</strong><span>{progress.source === 'vivo' ? 'vivo 原子笔记' : '小米云笔记'}</span></div>
    <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={Math.max(progress.total, 1)} aria-valuenow={progress.completed}><span style={{ width: `${percentage}%` }} /></div>
    <div className="progress-log" aria-label="最近导出日志">{logs.slice(0, 3).map((entry, index) => <span key={`${entry.time}-${index}`}>{entry.message}</span>)}</div>
  </section></div>;
}

function Clock3Icon() { return <Clock3 size={22} />; }

function providerName(provider: CloudProvider): string {
  return provider === 'xiaomi' ? '小米云笔记' : 'vivo 原子笔记';
}

function historyStatusLabel(status: ImportHistoryTask['status']): string {
  return { running: '正在导入', completed: '已完成', 'completed-with-issues': '完成但有问题', cancelled: '已取消', 'failed-to-start': '未能启动' }[status];
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
