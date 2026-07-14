/*
 * 在已登录的 https://pc.vivo.com.cn/suite?origin=cloudWeb#/note 页面控制台执行。
 * 选择 scripts/browser/xiaomi-export.js 生成的 JSON 后批量创建普通笔记。
 * 当前版本导入标题和正文；图片附件会计入报告，但不会上传。
 */
(async () => {
  const chooseJsonFile = () =>
    new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      input.addEventListener(
        'change',
        () => {
          const file = input.files?.[0];
          input.remove();
          if (file) resolve(file);
          else reject(new Error('FILE_NOT_SELECTED'));
        },
        { once: true }
      );
      document.body.appendChild(input);
      input.click();
    });

  const file = await chooseJsonFile();
  const exported = JSON.parse(await file.text());
  if (
    exported?.schemaVersion !== 1 ||
    exported?.source !== 'xiaomi-cloud-notes' ||
    !Array.isArray(exported.notes)
  ) {
    throw new Error('XIAOMI_EXPORT_INVALID');
  }

  const eligibleNotes = exported.notes.filter((note) => !note.encrypted);
  const encryptedCount = exported.notes.length - eligibleNotes.length;
  const attachmentCount = eligibleNotes.reduce(
    (total, note) => total + (Array.isArray(note.attachments) ? note.attachments.length : 0),
    0
  );
  const accepted = window.confirm(
    `将向当前 vivo 账号导入 ${eligibleNotes.length} 条笔记。\n` +
      `加密笔记跳过 ${encryptedCount} 条，图片附件暂不上传 ${attachmentCount} 个。\n` +
      '来源小米笔记不会被修改或删除。'
  );
  if (!accepted) throw new Error('IMPORT_CANCELLED');

  if (!window.__notechangeWebpackRequire) {
    if (!window.webpackJsonp?.push) throw new Error('VIVO_OFFICIAL_MODULE_UNAVAILABLE');
    window.webpackJsonp.push([
      [987655],
      {
        987655(module, exports, require) {
          window.__notechangeWebpackRequire = require;
        }
      },
      [[987655]]
    ]);
  }

  const require = window.__notechangeWebpackRequire;
  const requestClient = require?.(137)?.default;
  const syncApi = require?.(1281);
  if (!requestClient?.requestBranch || !syncApi?.createSync) {
    throw new Error('VIVO_OFFICIAL_MODULE_UNAVAILABLE');
  }

  let syncState = await requestClient.requestBranch({
    url: '/sync/getSyncState',
    syncName: 'getSyncState',
    method: 'POST',
    data: { type: 0 }
  });
  if (typeof syncState?.updateCount !== 'number') {
    throw new Error('VIVO_SYNC_STATE_INVALID');
  }

  const report = {
    schemaVersion: 1,
    importedAt: new Date().toISOString(),
    created: 0,
    failed: 0,
    encryptedSkipped: encryptedCount,
    attachmentsSkipped: attachmentCount,
    items: []
  };

  for (const source of eligibleNotes) {
    const now = Date.now();
    const createTime = source.createdAt ? Date.parse(source.createdAt) : now;
    const updateTime = source.modifiedAt ? Date.parse(source.modifiedAt) : createTime;
    const guid = crypto.randomUUID();
    const plainText = String(source.content ?? '').replace(/<[^>]*>/g, '').trim();
    const note = {
      guid,
      title: String(source.title ?? ''),
      contentDigest: plainText.slice(0, 60),
      content: String(source.content ?? ''),
      conflictTime: null,
      createTime: Number.isFinite(createTime) ? createTime : now,
      updateTime: Number.isFinite(updateTime) ? updateTime : now,
      contentUpdateTime: Number.isFinite(updateTime) ? updateTime : now,
      attrUpdateTime: Number.isFinite(updateTime) ? updateTime : now,
      importantLevel: 0,
      noteBookGuid: '0',
      tags: [],
      deleted: 1,
      dirty: 1,
      type: 1,
      contentLoaded: true,
      symbolCnf: '',
      paperTexture: '0',
      bgColor: 101,
      pageMargins: JSON.stringify([0, 16, 0, 16]),
      syncProtocolVersion: 0,
      isAiNote: 0,
      aiQuery: ''
    };

    try {
      const response = await syncApi.createSync({
        type: 0,
        lastUpdateCount: syncState.updateCount,
        noteBooks: [],
        notes: [note],
        tags: [],
        resources: []
      });
      if (typeof response?.updateCount !== 'number') {
        throw new Error('VIVO_CREATE_RESPONSE_INVALID');
      }
      syncState = response;
      report.created += 1;
      report.items.push({ sourceId: source.id, status: 'created' });
    } catch (error) {
      report.failed += 1;
      report.items.push({
        sourceId: source.id,
        status: 'failed',
        error: error instanceof Error ? error.message : 'UNKNOWN'
      });
    }
  }

  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `vivo-import-report-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  console.info(
    `vivo 导入完成：创建 ${report.created} 条，失败 ${report.failed} 条，` +
      `跳过加密笔记 ${report.encryptedSkipped} 条，跳过附件 ${report.attachmentsSkipped} 个`
  );
})().catch((error) => {
  console.error('vivo 导入停止：', error instanceof Error ? error.message : 'UNKNOWN');
});
