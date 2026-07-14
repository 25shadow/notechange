# NoteChange 设计规格

## 目标

构建一个本地桌面应用，在小米云笔记与 vivo 原子笔记之间双向迁移。首版迁移标题、正文、文件夹、图片附件及创建/修改时间，绝不删除来源端笔记。

## 范围

首版支持：

- 小米到 vivo、vivo 到小米的双向迁移。
- 文件夹层级、标题、HTML/文本正文、图片附件和时间字段。
- 预览、选择性迁移、重复项处理、进度报告、取消和失败项断点续传。
- 用户自行在 Playwright 浏览器上下文中登录。

首版不支持：

- 待办、音频、私密/加密笔记、手绘、复杂排版、历史版本、提醒和非图片附件的自动迁移。
- 删除来源端、自动覆盖目标端、云端托管账号和跨用户共享。

任何不支持或无法确定含义的内容都必须列入本地任务报告，标记为“需人工处理”，不得静默丢弃。

## 总体架构

桌面壳层使用 Electron、React 和 TypeScript。Electron 主进程负责 Playwright、文件系统、加密和任务执行；React 渲染进程只负责迁移向导、预览、确认界面、进度与报告。两者仅通过强类型 IPC 通信，主进程只向界面发送脱敏任务事件。

```text
React 渲染进程
  -> 强类型 IPC
Electron 主进程
  -> 迁移任务编排器
  -> 厂商适配器（小米、vivo）
  -> 加密任务存储与临时附件缓存
  -> Playwright 浏览器上下文
```

迁移编排器只依赖厂商无关的适配器接口。厂商的 URL、请求体、响应字段、分页和内容转换均封装在对应适配器内部。小米字段不得泄漏到 vivo 代码，vivo 字段也不得泄漏到小米代码。

## 厂商适配器契约

每个厂商适配器实现下列能力：

```ts
interface NotesProvider {
  startLogin(): Promise<LoginSession>;
  getLoginState(): Promise<LoginState>;
  listFolders(cursor?: string): Promise<Page<SourceFolder>>;
  listNotes(cursor?: string): Promise<Page<SourceNoteSummary>>;
  getNote(sourceId: string): Promise<SourceNote>;
  downloadAttachment(attachment: SourceAttachment): Promise<DownloadedAttachment>;
  createFolder(folder: TargetFolderInput): Promise<TargetFolder>;
  upsertNote(note: TargetNoteInput): Promise<TargetNote>;
  dispose(): Promise<void>;
}
```

`startLogin` 打开一个用户可见的持久浏览器窗口。密码、扫码、验证码、CAPTCHA 和二次验证均由用户直接在窗口中完成，应用不得自动填写、保存、记录或传输凭据。

适配器用 Playwright 建立登录会话，并在同一已认证浏览器上下文中观察官方网页使用的数据通道。请求格式必须先用专用测试账号验证；通过后，数据分页和批量迁移可在该上下文中调用已验证的请求。页面点击仅限可见的登录和明确的人机确认，不以脆弱的逐条列表点击来完成批量迁移。

## 统一数据模型

任务存储使用厂商无关的统一模型：

```ts
type CanonicalFolder = {
  sourceId: string;
  parentSourceId: string | null;
  name: string;
  createdAt: string | null;
  modifiedAt: string | null;
};

type CanonicalAttachment = {
  sourceId: string;
  mimeType: string;
  filename: string;
  sha256: string;
  localPath: string;
};

type CanonicalNote = {
  sourceId: string;
  folderSourceId: string | null;
  title: string;
  html: string;
  plainText: string;
  attachments: CanonicalAttachment[];
  createdAt: string | null;
  modifiedAt: string | null;
  contentHash: string;
  warnings: MigrationWarning[];
};
```

内容转换器负责清洗来源 HTML，保留支持的强调、段落、列表、链接和图片引用，同时生成 HTML 与纯文本。不支持的结构必须生成警告，并在目标笔记写入可读的降级说明。

## 迁移流程

1. 用户选择迁移方向及来源/目标账号。
2. 应用打开来源和目标的登录会话，并验证二者状态。
3. 来源适配器分页读取文件夹和笔记摘要，获取完整笔记，并将图片附件下载到加密任务缓存。
4. 转换器生成统一笔记模型，校验附件哈希，并记录不支持内容的警告。
5. 用户预览数量、警告、疑似重复项和选定文件夹；此阶段不得写入目标端。
6. 用户明确确认后，编排器创建已映射的目标文件夹、上传附件并逐条创建目标笔记。
7. 每完成一次写入，即持久化“来源 ID 到目标 ID”的映射及内容哈希；重启时仅恢复未完成项。
8. 最终报告区分已创建、已跳过、失败和需人工处理项。除非用户明确要求保留加密报告，否则应用销毁浏览器上下文并清除任务缓存。

## 幂等与冲突策略

映射表是首选的重复检测依据。没有映射时，工具以标题、内容哈希、文件夹路径和可配置的时间窗口检测目标端候选项。疑似重复的默认动作是跳过；用户可在预览阶段为单条笔记选择“创建副本”或“覆盖”。首版不提供批量覆盖。

每次写入仅在确认收到厂商成功响应后更新检查点。临时网络错误和限流使用有上限的指数退避。认证失效、CAPTCHA、不支持的加密笔记、内容格式错误或目标端校验失败时，仅暂停受影响项，其他安全项可继续执行；用户重新认证或处理该项后任务可恢复。

## 安全与隐私

- 密码、验证码、二维码内容、Cookie、授权头、标题、正文、附件名和附件字节不得进入应用日志或分析服务。
- Playwright 浏览器上下文按任务创建，在完成或取消任务时销毁。
- 任务缓存使用随机数据密钥加密，数据密钥由操作系统凭据存储保护；缓存文件使用严格的本地权限。
- 渲染进程 IPC 仅暴露数量、脱敏条目 ID、状态和错误分类。笔记内容保留在主进程，只在用户主动打开预览时传入界面。
- 崩溃报告只包含软件版本、厂商、操作阶段和脱敏错误分类；默认关闭遥测。

## 用户体验

应用首屏直接进入迁移工作区。主流程是四步向导：选择方向、登录、预览、迁移。常驻任务面板显示条目数量和最近的脱敏错误。两个账号均已认证且用户已查看警告前，写入按钮必须禁用。

第一次写入目标端前必须显示确认对话框，明确展示目标厂商/账号、选择的笔记与附件数量、重复项策略，以及来源数据不会被删除。

## 验证策略

- 单元测试：内容转换、时间映射、文件夹映射、重复检测、警告生成、加密缓存元数据和检查点状态迁移。
- 适配器测试：用 Playwright 路由夹具覆盖分页、附件下载、创建、更新、限流、认证失效、内容异常与重试。
- 集成测试：通过夹具适配器执行完整迁移，验证重复运行幂等、取消、恢复及日志中不存在明文内容。
- 人工端到端测试：仅使用含合成笔记和附件的小米/vivo 专用测试账号，自动化测试禁止使用真实账号或个人笔记。

## 验收标准

- 用户可完成受支持内容的小米到 vivo、vivo 到小米迁移。
- 默认策略下，同一任务重复运行不会生成重复的目标笔记。
- 中断的任务在重新认证后从最后一个检查点继续。
- 不支持的条目会出现在报告中，且不会阻塞无关的受支持条目。
- 日志与持久化报告不包含明文笔记、凭据材料、Cookie 或附件名。
- 迁移结束后来源端笔记保持不变。
