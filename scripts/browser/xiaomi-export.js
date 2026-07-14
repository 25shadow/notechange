/*
 * 在已登录的 https://i.mi.com/note/h5#/ 页面控制台执行。
 * 脚本只调用已验证的同源读取接口，并下载一个 JSON 文件。
 */
(async () => {
  const contract = {
    listNotes: { method: 'GET', path: '/note/full/page' },
    getNote: { method: 'GET', path: '/note/note/:id/' }
  };
  const pageSize = 200;

  const requestJson = async (path) => {
    const response = await fetch(path, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const envelope = await response.json();
    if (envelope.code !== 0 || !envelope.data) {
      throw new Error(`XIAOMI_API_${String(envelope.code ?? 'UNKNOWN')}`);
    }
    return envelope.data;
  };

  const summaries = [];
  const folders = new Map();
  let syncTag;
  let lastPage = false;

  while (!lastPage) {
    const query = new URLSearchParams({
      limit: String(pageSize),
      ts: String(Date.now())
    });
    if (syncTag) query.set('syncTag', syncTag);

    const data = await requestJson(`${contract.listNotes.path}?${query}`);
    if (!Array.isArray(data.entries) || !Array.isArray(data.folders)) {
      throw new Error('XIAOMI_RESPONSE_INVALID:listNotes');
    }
    summaries.push(...data.entries);
    for (const folder of data.folders) {
      if (folder && folder.id != null) folders.set(String(folder.id), folder);
    }
    lastPage = data.lastPage === true;
    syncTag = data.syncTag;
    if (!lastPage && typeof syncTag !== 'string') {
      throw new Error('XIAOMI_RESPONSE_INVALID:syncTag');
    }
  }

  const notes = [];
  for (let index = 0; index < summaries.length; index += 1) {
    const summary = summaries[index];
    const path = contract.getNote.path.replace(':id', encodeURIComponent(summary.id));
    const data = await requestJson(`${path}?ts=${Date.now()}`);
    if (!data.entry || typeof data.entry.content !== 'string') {
      throw new Error('XIAOMI_RESPONSE_INVALID:getNote');
    }
    const entry = data.entry;
    notes.push({
      id: entry.id,
      folderId: entry.folderId == null ? null : String(entry.folderId),
      title: entry.subject ?? '',
      content: entry.content,
      createdAt: Number.isFinite(entry.createDate)
        ? new Date(entry.createDate).toISOString()
        : null,
      modifiedAt: Number.isFinite(entry.modifyDate)
        ? new Date(entry.modifyDate).toISOString()
        : null,
      attachments: Array.isArray(entry.setting?.data)
        ? entry.setting.data.map(({ fileId, mimeType, digest }) => ({
            fileId,
            mimeType,
            digest
          }))
        : [],
      encrypted: entry.encryptInfo != null
    });
  }

  const output = {
    schemaVersion: 1,
    source: 'xiaomi-cloud-notes',
    exportedAt: new Date().toISOString(),
    contract: {
      assetVersion: 'main.3709ac69.chunk.js',
      listNotes: contract.listNotes,
      getNote: contract.getNote
    },
    folders: [...folders.values()],
    notes
  };
  const blob = new Blob([JSON.stringify(output, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `xiaomi-notes-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  console.info(`小米笔记导出完成：${notes.length} 条`);
})().catch((error) => {
  console.error('小米笔记导出失败：', error instanceof Error ? error.message : 'UNKNOWN');
});
