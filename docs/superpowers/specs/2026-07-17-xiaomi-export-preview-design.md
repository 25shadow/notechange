# 小米完整本地导出与预览弹窗设计

## 目标

小米笔记导出完成后，将本次导出的全部笔记正文、元数据和图片附件保存为本地批次。用户可以点击“查看导出内容”打开预览弹窗，搜索并逐条查看本次导出的笔记；应用重启后仍能恢复最近批次并继续预览或导入 vivo。

本地批次不加密，存放在 Electron 应用数据目录，不要求用户选择文件夹。

## 本地批次格式

每次成功导出生成独立目录：

```text
<userData>/exports/<batchId>/
├── manifest.json
├── notes.json
└── attachments/
    ├── <sha256>.png
    └── <sha256>.jpg
```

- `batchId` 使用 UTC 时间前缀和随机 UUID，既可排序又不会冲突。
- `manifest.json` 保存 schema 版本、批次 ID、创建时间、来源、笔记数、附件数和警告数。
- `notes.json` 保存规范化笔记、正文、时间、文件夹、警告和附件相对路径。
- 附件文件名使用已经计算的 SHA-256，并根据受支持 MIME 类型追加扩展名，避免重名和路径注入。
- 相同批次内相同 SHA-256 的附件只保存一份，多条笔记可以引用同一文件。
- 根目录使用 `latest.json` 保存最近完成的批次 ID。

保存过程先写入 `<batchId>.tmp` 临时目录。笔记 JSON 与全部附件成功后，将临时目录原子改名为正式批次目录，再原子更新 `latest.json`。失败时删除临时目录，不把不完整批次暴露给 UI。

## 生命周期

### 导出

1. 通过现有小米接口契约读取列表、正文和全部附件。
2. 生成内存 `ExportBundle`。
3. 将 bundle 完整保存到新的本地批次。
4. 保存成功后才向渲染进程返回导出统计。
5. 当前 runtime 继续持有该 bundle，供立即预览和导入。

### 应用启动

1. 首次查询本地导出状态时读取 `latest.json`。
2. 校验 `manifest.json` 和 `notes.json` 的 schema 版本及计数字段。
3. 将最近批次恢复为内存 bundle。
4. UI 显示最近批次统计和“查看导出内容”，不要求重新连接小米。
5. 文件缺失、JSON 损坏或附件越界时返回 `LOCAL_EXPORT_INVALID`，不得部分加载。

### 导入

本地恢复的 bundle 与刚导出的 bundle 使用同一数据结构，可以继续执行现有确认和 vivo 导入流程。来源小米会话只在重新导出时需要；从本地批次导入不依赖小米在线。

## 预览交互

导出统计区域增加带查看图标的“查看导出内容”按钮。点击后打开居中的大尺寸模态弹窗，背景内容不可操作。

弹窗由三部分组成：

1. 顶部工具栏：批次时间、笔记总数、搜索框、筛选控件和关闭图标。
2. 左侧笔记列表：显示标题、正文摘要、修改时间、附件数和警告标记；每页 50 条。
3. 右侧详情：显示完整标题、创建/修改时间、来源文件夹、纯文本正文、图片附件和具体警告。

筛选项为“全部”“需处理”“有附件”。搜索匹配标题和纯文本正文，不区分大小写。搜索或筛选变化时返回第一页并默认选择第一条结果。点击列表项切换右侧详情。

弹窗支持加载、搜索无结果、详情错误和图片读取失败状态。点击关闭图标或按 Escape 关闭弹窗。

## IPC 数据边界

新增只读 IPC：

```ts
type ExportPreviewFilter = 'all' | 'warnings' | 'attachments';

type ExportPreviewQuery = {
  search: string;
  filter: ExportPreviewFilter;
  offset: number;
  limit: number;
};

type LocalExportSummary = {
  batchId: string;
  exportedAt: string;
  noteCount: number;
  attachmentCount: number;
  warningCount: number;
};

type ExportPreviewPage = {
  total: number;
  items: ExportPreviewItem[];
};
```

- `getLatestExportSummary()` 恢复并返回最近批次统计，没有批次时返回 `null`。
- `getExportPreview(query)` 对当前 bundle 搜索、筛选和分页，只返回标题、摘要、时间和计数。
- `getExportPreviewDetail(sourceId)` 返回纯文本详情、警告及附件元数据。
- `getExportAttachment(sourceId, sha256)` 校验附件属于指定笔记和当前批次后，读取本地文件并返回 MIME 类型与 base64 数据；不向渲染进程暴露路径。
- limit 限制在 1 到 100，offset 不得为负数。
- bundle 不存在时返回 `EXPORT_BUNDLE_MISSING`，笔记不存在时返回 `EXPORT_NOTE_MISSING`，附件不存在时返回 `EXPORT_ATTACHMENT_MISSING`。

## 安全与完整性

- 正文只渲染 `plainText`，使用 `white-space: pre-wrap` 保留换行；不得对云端 HTML 使用 `dangerouslySetInnerHTML`。
- 所有本地 JSON 和附件使用权限 `0600` 创建，批次目录只允许当前用户访问。
- 读取附件时使用已保存的相对路径并校验解析后的绝对路径仍位于当前批次目录内。
- 不记录搜索词、标题、正文、附件内容、Cookie 或认证字段。
- 本地文件不加密，这是用户明确选择；UI 保留“本地处理”说明，不宣称加密存储。

## 组件边界

- `FileExportBundleStore`：负责原子保存、最近批次索引、schema 校验、附件复制和安全读取。
- `MigrationRuntime`：导出后调用 store，启动时恢复最近 bundle，并提供预览查询。
- `shared/ipc.ts`：定义本地批次、预览和附件请求响应。
- `runtime/ipc-handlers.ts`：校验预览参数并转发。
- `main/preload.ts`：暴露只读预览方法。
- `renderer/ExportPreviewDialog.tsx`：管理搜索、筛选、分页、选择、详情和图片状态。
- `renderer/App.tsx`：加载最近批次统计并控制弹窗开关。

## 测试

- Store 测试覆盖完整保存、附件去重、原子完成、最近批次恢复、损坏 JSON、缺失附件和路径越界。
- Runtime 测试覆盖导出后保存、应用启动恢复、搜索、筛选、分页和详情裁剪。
- IPC 测试覆盖新增 channel、参数校验和附件读取。
- React 测试覆盖按钮、弹窗开关、搜索、筛选、分页、选择笔记、正文和图片展示。
- 安全测试断言云端 HTML 不会作为 DOM 执行或渲染。
- 使用真实小米会话验证 318 条笔记和 19 个附件可生成完整本地批次。
- 完整运行测试、TypeScript 检查、契约校验和 Electron 生产构建。

## 非目标

- 本次不支持编辑、删除或重新排序本地批次内容。
- 本次不提供导出到用户指定目录或分享功能。
- 本次不改变 vivo 登录和接口写入契约。
