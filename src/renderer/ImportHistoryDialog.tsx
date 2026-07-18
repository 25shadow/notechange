import { AlertTriangle, CheckCircle2, Clock3, X } from 'lucide-react';

import type { ImportHistoryTask } from '../shared/ipc';

type ImportHistoryDialogProps = {
  task: ImportHistoryTask;
  onClose: () => void;
};

export function ImportHistoryDialog({ task, onClose }: ImportHistoryDialogProps) {
  const { progress } = task;
  return (
    <div className="preview-overlay" role="presentation">
      <section className="preview-dialog import-history-dialog" role="dialog" aria-modal="true" aria-label="导入历史详情">
        <header className="preview-dialog-header">
          <div><h2>导入历史详情</h2><p>{formatDate(task.startedAt)} · {statusLabel(task.status)}</p></div>
          <button className="preview-icon-button" onClick={onClose} title="关闭导入详情" aria-label="关闭导入详情"><X size={18} /></button>
        </header>
        <div className="history-summary" aria-label="导入汇总">
          <span><CheckCircle2 size={16} />新增 {progress.created}</span><span>跳过 {progress.skipped}</span><span>失败 {progress.failed}</span><span>人工核对 {progress.manualReview}</span>
        </div>
        <div className="history-content">
          <section className="history-block" aria-label="导入日志"><h3><Clock3 size={16} />导入日志</h3>
            {task.logs.length ? <ol className="history-log-list">{task.logs.map((log, index) => <li key={`${log.occurredAt}-${index}`} className={`history-log-${log.kind}`}><time>{formatTime(log.occurredAt)}</time><span>{log.message}</span></li>)}</ol> : <p className="history-empty">没有可用的导入日志。</p>}
          </section>
          <section className="history-block" aria-label="失败与人工核对"><h3><AlertTriangle size={16} />失败与人工核对</h3>
            {task.failures.length ? <table className="history-failure-table"><thead><tr><th>笔记</th><th>结果</th><th>原因</th></tr></thead><tbody>{task.failures.map((failure) => {
              const attachment = isAttachmentUploadUnverified(failure.errorCode)
                ? failure.attachment
                : undefined;
              return <tr key={`${failure.sourceId}-${failure.occurredAt}`} className={attachment ? 'history-attachment-omission' : undefined}><td>{failure.title}{attachment && <small>附件未迁移：{attachment.filename}</small>}</td><td>{failure.outcome === 'manual-review' ? '人工核对' : '失败'}</td><td>{attachment ? `${failure.errorCode.startsWith('VIVO_') ? 'vivo' : '小米'} 网页端附件上传尚未验证` : failure.message}<small>{failure.errorCode}</small></td></tr>;
            })}</tbody></table> : <p className="history-empty">本次导入没有失败或待核对记录。</p>}
          </section>
        </div>
      </section>
    </div>
  );
}

function isAttachmentUploadUnverified(errorCode: string): boolean {
  return errorCode === 'VIVO_ATTACHMENT_UPLOAD_UNVERIFIED' ||
    errorCode === 'XIAOMI_ATTACHMENT_UPLOAD_UNVERIFIED';
}

function statusLabel(status: ImportHistoryTask['status']): string {
  return { running: '正在导入', completed: '已完成', 'completed-with-issues': '完成但有问题', cancelled: '已取消', 'failed-to-start': '未能启动' }[status];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}
