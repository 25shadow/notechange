# 小米导出笔记预览弹窗设计

## 目标

小米笔记导出完成后，用户可以点击“查看导出内容”打开预览弹窗，搜索并逐条查看本次导出的笔记，在导入 vivo 前核对标题、正文、时间、附件和需处理原因。

## 交互设计

导出统计区域增加带查看图标的“查看导出内容”按钮。点击后打开居中的大尺寸模态弹窗，背景内容不可操作。

弹窗由三部分组成：

1. 顶部工具栏：标题、笔记总数、搜索框、筛选控件和关闭图标。
2. 左侧笔记列表：显示标题、正文摘要、修改时间、附件数和警告标记；列表分页加载，每页 50 条。
3. 右侧详情：显示完整标题、创建/修改时间、来源文件夹、纯文本正文、附件元数据和具体警告。

筛选项为“全部”“需处理”“有附件”。搜索匹配标题和纯文本正文，不区分大小写。搜索或筛选变化时返回第一页并默认选择第一条结果。点击列表项切换右侧详情。

弹窗支持以下状态：

- 无导出批次时按钮不显示。
- 加载时保持稳定布局并显示局部加载状态。
- 搜索无结果时显示空状态。
- 当前笔记读取失败时显示详情错误，不关闭整个弹窗。
- 点击关闭图标或按 Escape 关闭弹窗。

## 数据边界

完整导出数据继续保存在 Electron 主进程 `MigrationRuntime` 的内存 `bundle` 中，不写新的笔记明文文件。

新增两个只读 IPC：

```ts
type ExportPreviewFilter = 'all' | 'warnings' | 'attachments';

type ExportPreviewQuery = {
  search: string;
  filter: ExportPreviewFilter;
  offset: number;
  limit: number;
};

type ExportPreviewPage = {
  total: number;
  items: ExportPreviewItem[];
};

type ExportPreviewItem = {
  sourceId: string;
  title: string;
  excerpt: string;
  modifiedAt: string | null;
  attachmentCount: number;
  warningCount: number;
};

type ExportPreviewDetail = {
  sourceId: string;
  folderSourceId: string | null;
  title: string;
  plainText: string;
  createdAt: string | null;
  modifiedAt: string | null;
  attachments: Array<{ filename: string; mimeType: string }>;
  warnings: Array<{ code: string; message: string }>;
};
```

- `getExportPreview(query)` 对内存 bundle 搜索、筛选和分页，不返回 HTML、附件本地路径或哈希。
- `getExportPreviewDetail(sourceId)` 只返回当前 bundle 中匹配笔记的安全详情。
- bundle 不存在时返回 `EXPORT_BUNDLE_MISSING`。
- sourceId 不存在时返回 `EXPORT_NOTE_MISSING`。
- limit 限制在 1 到 100，offset 不得为负数。

## 安全渲染

右侧正文只渲染 `plainText`，使用 CSS `white-space: pre-wrap` 保留换行。不得对云端 `html` 使用 `dangerouslySetInnerHTML`，避免远端内容在 Electron 渲染进程中执行。

附件只展示文件名和 MIME 类型，不暴露本地临时路径、摘要或认证信息。搜索在主进程内存执行，日志不记录搜索词、标题或正文。

## 组件边界

- `MigrationRuntime`：提供分页预览和单条详情查询。
- `shared/ipc.ts`：定义预览请求、响应和 IPC channel。
- `runtime/ipc-handlers.ts`：校验 provider 无关的预览参数并转发给 runtime。
- `main/preload.ts`：向渲染进程暴露两个只读方法。
- `renderer/ExportPreviewDialog.tsx`：管理搜索、筛选、分页、选择和详情状态。
- `renderer/App.tsx`：控制弹窗开关，不持有预览数据细节。
- `renderer/styles.css`：定义稳定的双栏弹窗、列表行、筛选控件和窄窗口布局。

## 测试

- Runtime 单元测试覆盖搜索、三种筛选、分页、limit/offset 校验和详情字段裁剪。
- IPC 测试覆盖两个 channel 的注册和参数传递。
- React 测试覆盖打开/关闭、搜索、筛选、分页、选择笔记和正文展示。
- 安全测试断言云端 HTML 不会作为 DOM 元素执行或渲染。
- 完整运行测试、TypeScript 检查、契约校验和 Electron 生产构建。

## 非目标

- 本次不支持编辑、删除或重新排序小米笔记。
- 本次不提供笔记 JSON/HTML 文件导出。
- 本次不预览图片二进制内容，只展示附件元数据。
- 本次不改变 vivo 登录或导入流程。
