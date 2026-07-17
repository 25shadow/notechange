# Export Batch List and Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 展示所有本地小米导出批次，支持查看任意批次并安全删除单个批次。

**Architecture:** 文件存储层负责批次枚举、校验、读取和删除；运行时维护明确选中的待导入批次；IPC 只传批次 ID 和无敏感摘要；React 界面用批次表格与二次确认对话框调用这些能力。预览、详情和附件查询全部显式携带 `batchId`，避免跨批次读取。

**Tech Stack:** TypeScript、Electron IPC、React、Vitest、Testing Library、Node.js `fs/promises`、Zod

---

## 文件结构

- 修改 `src/main/storage/export-bundle-store.ts`：定义 `list`、`load`、`delete` 契约。
- 修改 `src/main/storage/file-export-bundle-store.ts`：实现安全批次枚举、读取、删除和 `latest.json` 修复。
- 修改 `src/main/runtime/migration-runtime.ts`：提供列表、选择、删除以及按批次预览。
- 修改 `src/shared/ipc.ts`：定义批次作用域请求和渲染 API。
- 修改 `src/main/runtime/ipc-handlers.ts`、`src/main/preload.ts`：暴露白名单 IPC。
- 修改 `src/renderer/App.tsx`：渲染批次列表、选择状态和删除确认框。
- 修改 `src/renderer/ExportPreviewDialog.tsx`：所有预览读取携带 `batchId`。
- 修改 `src/renderer/index.css`：批次表格、危险按钮和确认框样式。
- 修改对应 `tests/unit/*.test.*`：先失败、后实现。

### Task 1: 存储层批次列表、读取和删除

**Files:**
- Modify: `src/main/storage/export-bundle-store.ts`
- Modify: `src/main/storage/file-export-bundle-store.ts`
- Test: `tests/unit/file-export-bundle-store.test.ts`

- [ ] **Step 1: 写多批次与安全删除失败测试**

在测试中连续保存两个批次，并断言：

```ts
const first = await store.save(bundle);
const second = await store.save(bundle);
expect((await store.list()).map((item) => item.batchId)).toEqual([
  second.batchId,
  first.batchId
]);
await expect(store.load(first.batchId)).resolves.toMatchObject({ batchId: first.batchId });
await store.delete(second.batchId);
expect(await store.load(second.batchId)).toBeNull();
expect((await store.loadLatest())?.batchId).toBe(first.batchId);
await expect(store.delete('../outside')).rejects.toThrow('EXPORT_BATCH_ID_INVALID');
```

再覆盖删除最后一批后 `loadLatest()` 返回 `null`，以及 `.tmp`、损坏目录不进入 `list()`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- tests/unit/file-export-bundle-store.test.ts`

Expected: FAIL，提示 `list/load/delete` 不存在。

- [ ] **Step 3: 扩展存储接口**

```ts
export interface ExportBundleStore {
  save(bundle: ExportBundle): Promise<StoredExportBundle>;
  list(): Promise<StoredExportBundle[]>;
  load(batchId: string): Promise<StoredExportBundle | null>;
  loadLatest(): Promise<StoredExportBundle | null>;
  delete(batchId: string): Promise<void>;
  readAttachment(batchId: string, relativePath: string): Promise<Uint8Array>;
}
```

- [ ] **Step 4: 实现最小安全文件操作**

提取 `loadBatch(batchId)` 复用 manifest、notes、计数和附件校验；使用 `readdir({ withFileTypes: true })` 扫描直接子目录并忽略 `.tmp`。批次 ID 只允许字母、数字、点、下划线和连字符，且拒绝 `.`、`..`：

```ts
function assertBatchId(batchId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(batchId) || batchId === '.' || batchId === '..') {
    throw new Error('EXPORT_BATCH_ID_INVALID');
  }
}
```

`delete` 使用 `rm(batchDirectory, { recursive: true, force: true })`，随后从剩余有效批次重建或删除 `latest.json`。

- [ ] **Step 5: 运行存储测试并确认 GREEN**

Run: `npm test -- tests/unit/file-export-bundle-store.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交存储层**

```bash
git add src/main/storage/export-bundle-store.ts src/main/storage/file-export-bundle-store.ts tests/unit/file-export-bundle-store.test.ts
git commit -m "feat: manage local export batches"
```

### Task 2: 运行时选择、列表、删除与批次作用域预览

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/runtime/migration-runtime.ts`
- Test: `tests/unit/migration-runtime.test.ts`

- [ ] **Step 1: 扩展内存存储夹具并写失败测试**

`MemoryExports` 实现 `list/load/delete`，测试两个批次：

```ts
await expect(runtime.listExports()).resolves.toEqual([
  expect.objectContaining({ batchId: 'batch-2' }),
  expect.objectContaining({ batchId: 'batch-1' })
]);
await runtime.selectExport('batch-1');
await expect(runtime.getExportPreview({
  batchId: 'batch-1', search: '', filter: 'all', offset: 0, limit: 50
})).resolves.toMatchObject({ total: 1 });
await runtime.deleteExport('batch-1');
expect(() => runtime.confirmMigration()).toThrow('EXPORT_BUNDLE_MISSING');
```

另测删除非当前批次不清空当前选择。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- tests/unit/migration-runtime.test.ts`

Expected: FAIL，提示新方法或 `batchId` 请求字段不存在。

- [ ] **Step 3: 定义共享请求类型**

```ts
export type ExportPreviewQuery = {
  batchId: string;
  search: string;
  filter: ExportPreviewFilter;
  offset: number;
  limit: number;
};

export type ExportNoteRequest = { batchId: string; sourceId: string };
export type ExportAttachmentRequest = ExportNoteRequest & { sha256: string };
```

`NoteChangeApi` 增加 `listExports()`、`selectExport(batchId)`、`deleteExport(batchId)`，并让详情和附件方法接收请求对象。

- [ ] **Step 4: 实现运行时方法**

```ts
async listExports(): Promise<LocalExportSummary[]> {
  return (await this.options.exports.list()).map(toLocalSummary);
}

async selectExport(batchId: string): Promise<LocalExportSummary> {
  const stored = await this.options.exports.load(batchId);
  if (!stored) throw new Error('EXPORT_BUNDLE_MISSING');
  this.storedExport = stored;
  this.bundle = stored.bundle;
  this.confirmed = false;
  return toLocalSummary(stored);
}

async deleteExport(batchId: string): Promise<void> {
  await this.options.exports.delete(batchId);
  if (this.storedExport?.batchId === batchId) {
    this.storedExport = null;
    this.bundle = null;
    this.confirmed = false;
    this.orchestrator = null;
  }
}
```

预览、详情和附件方法必须使用请求里的 `batchId` 调用 `exports.load(batchId)`，不能隐式读取当前批次。

- [ ] **Step 5: 运行运行时与类型测试并确认 GREEN**

Run: `npm test -- tests/unit/migration-runtime.test.ts && npm run typecheck`

Expected: PASS。

- [ ] **Step 6: 提交运行时**

```bash
git add src/shared/ipc.ts src/main/runtime/migration-runtime.ts tests/unit/migration-runtime.test.ts
git commit -m "feat: select and delete export batches"
```

### Task 3: IPC 与 preload 白名单

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/runtime/ipc-handlers.ts`
- Modify: `src/main/preload.ts`
- Test: `tests/unit/ipc-handlers.test.ts`

- [ ] **Step 1: 写新通道转发失败测试**

```ts
await handlers.get(ipcChannels.listExports)?.({});
expect(runtime.listExports).toHaveBeenCalledOnce();
await handlers.get(ipcChannels.selectExport)?.({}, 'batch-1');
expect(runtime.selectExport).toHaveBeenCalledWith('batch-1');
await handlers.get(ipcChannels.deleteExport)?.({}, 'batch-1');
expect(runtime.deleteExport).toHaveBeenCalledWith('batch-1');
```

同时断言预览、详情和附件请求对象原样转发。

- [ ] **Step 2: 运行 IPC 测试并确认 RED**

Run: `npm test -- tests/unit/ipc-handlers.test.ts`

Expected: FAIL，缺少通道和运行时命令。

- [ ] **Step 3: 注册最小 IPC 实现**

新增：

```ts
listExports: 'notechange:list-exports',
selectExport: 'notechange:select-export',
deleteExport: 'notechange:delete-export'
```

handler 对批次 ID 使用 `String(batchId)`，preload 只调用 `ipcRenderer.invoke`，不暴露文件路径。

- [ ] **Step 4: 运行 IPC 测试与类型检查并确认 GREEN**

Run: `npm test -- tests/unit/ipc-handlers.test.ts && npm run typecheck`

Expected: PASS。

- [ ] **Step 5: 提交 IPC**

```bash
git add src/shared/ipc.ts src/main/runtime/ipc-handlers.ts src/main/preload.ts tests/unit/ipc-handlers.test.ts
git commit -m "feat: expose export batch management IPC"
```

### Task 4: 批次列表、预览选择和删除确认界面

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/ExportPreviewDialog.tsx`
- Modify: `src/renderer/index.css`
- Modify: `tests/unit/migration-wizard.test.tsx`
- Modify: `tests/unit/export-preview-dialog.test.tsx`

- [ ] **Step 1: 更新假 API 并写界面失败测试**

令 `listExports()` 返回两批，断言两行及操作按钮；点击第二行“查看”后：

```ts
expect(api.selectExport).toHaveBeenCalledWith('batch-1');
expect(api.getExportPreview).toHaveBeenCalledWith(
  expect.objectContaining({ batchId: 'batch-1' })
);
```

点击第一行“删除”，确认框必须显示“只删除 NoteChange 本地保存”，点击“删除本地批次”后断言 `deleteExport(batchId)` 被调用、列表刷新；取消时不得调用。删除失败时保留该行并显示错误。

- [ ] **Step 2: 运行界面测试并确认 RED**

Run: `npm test -- tests/unit/migration-wizard.test.tsx tests/unit/export-preview-dialog.test.tsx`

Expected: FAIL，找不到批次行和删除按钮。

- [ ] **Step 3: 实现批次列表状态**

将 `summary` 改为 `exports: LocalExportSummary[]` 与 `selectedExport: LocalExportSummary | null`。启动时并行调用 `listExports()`，默认选择首项；导出成功后刷新列表并选中新批次。每行使用批次 ID 生成可访问名称，例如 `删除 2026/7/17 10:35 的导出批次`。

- [ ] **Step 4: 实现查看和删除确认**

“查看”先 `await api.selectExport(batchId)`，再设置选择并打开预览。确认框用原生 React 对话层，包含统计和本地删除边界。删除成功后重新调用 `listExports()`；若删除的是当前选择则关闭预览、取消确认并把选择设为 `null`。

- [ ] **Step 5: 给预览请求添加 batchId**

```ts
api.getExportPreview({ batchId: summary.batchId, search, filter, offset, limit: pageSize });
api.getExportPreviewDetail({ batchId: summary.batchId, sourceId: selectedId });
api.getExportAttachment({ batchId: summary.batchId, sourceId, sha256: attachment.sha256 });
```

- [ ] **Step 6: 添加克制的列表和危险操作样式**

复用现有绿色、灰色和圆角，仅为删除按钮使用 `#a34331` 与浅红确认区域。移动端将表头隐藏、每行改为网格卡片；键盘焦点保持可见，确认框支持 Escape 关闭。

- [ ] **Step 7: 运行界面测试并确认 GREEN**

Run: `npm test -- tests/unit/migration-wizard.test.tsx tests/unit/export-preview-dialog.test.tsx && npm run typecheck`

Expected: PASS。

- [ ] **Step 8: 提交界面**

```bash
git add src/renderer/App.tsx src/renderer/ExportPreviewDialog.tsx src/renderer/index.css tests/unit/migration-wizard.test.tsx tests/unit/export-preview-dialog.test.tsx
git commit -m "feat: list and delete local export batches"
```

### Task 5: 全量验证与真实本地数据检查

**Files:**
- Modify only if verification exposes an in-scope defect.

- [ ] **Step 1: 运行完整自动验证**

Run:

```bash
npm test -- --maxWorkers=1
npm run typecheck
node scripts/validate-contracts.mjs
npm run build
```

Expected: 所有测试通过、2 份契约有效、Electron 构建成功。

- [ ] **Step 2: 手工验证不触碰云端**

在开发应用中确认列表能读取现有批次；新建一个仅含合成数据的测试批次，查看并删除它。检查该批次目录和附件已消失，其他批次仍存在。不得调用小米或 vivo 删除接口。

- [ ] **Step 3: 检查工作区与提交历史**

Run: `git status --short && git log -5 --oneline`

Expected: 工作区干净，功能提交均位于当前 `main`。
