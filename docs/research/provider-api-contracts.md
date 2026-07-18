# 小米云笔记与 vivo 原子笔记接口契约

采集日期：2026-07-14

## 适用范围

本文记录 NoteChange 首版所需的笔记列表、正文、文件夹、图片附件、创建、更新和删除契约。接口均来自当前官方网页版本，按验证等级区分：

- `network-verified`：已在用户登录态中观察到真实网络请求。
- `source-verified`：已在当前官方前端构建产物中确认路径、方法和参数，但本次会话未触发该请求。

这些接口不是厂商公开 API，随网页版本变化时必须重新运行契约验证。应用只允许在 Playwright 的登录浏览器上下文中调用，禁止保存 Cookie、`serviceToken`、`jvq_param` 明文或任何笔记正文到日志。

## 小米云笔记

网页入口：`https://i.mi.com/note/h5#/`

当前前端构建：`main.3709ac69.chunk.js`

### 登录态实测

| 方法 | 路径 | 参数或请求体 | 用途 |
| --- | --- | --- | --- |
| GET | `/note/v2/hasData` | 查询：`ts` | 检查新版笔记数据 |
| GET | `/status/lite/profile` | 查询：`ts` | 读取当前账号与容量状态 |
| GET | `/note/full/page` | 查询：`limit`、可选 `syncTag`、`ts` | 分页读取笔记和文件夹 |
| GET | `/note/index/check` | 查询：`ts` | 检查服务端搜索索引 |
| GET | `/note/sync/full/` | 查询：`data`、`inactiveTime`、`ts` | 增量同步 |
| POST | `/note/note` | 表单：`entry`、网页自动附加 `serviceToken` | 创建笔记 |
| GET | `/note/note/:id/` | 查询：`ts` | 读取单条完整笔记 |

`POST /note/note` 的 `entry` 是 JSON 字符串。普通文本笔记的源码定义字段如下：

```ts
type XiaomiCreateEntry = {
  content: string;
  colorId: number;
  folderId: string;
  alertDate: number;
  createDate: number;
  modifyDate: number;
  extraInfo?: string;
  encryptInfo?: unknown;
};
```

### 标题字段

`GET /note/note/:id/` 返回的 `entry.subject` 在真实数据中通常为空，不能作为标题。
真实标题位于 `entry.extraInfo` JSON 字符串的 `title` 字段；同一 JSON 的
`note_content_type` 表示内容类型（实测包括 `common`，参考实现还处理 `mind`）。

2026-07-17 在已登录官网抽样 19 条详情：19 条 `subject` 均为空，10 条存在非空
`extraInfo.title`，并观察到 `title`、`note_content_type`、`mind_content`、
`mind_content_plain_text` 四个 `extraInfo` 键。抽样只记录字段和计数，不保存标题或正文。

社区参考代码也按 `JSON.parse(extraInfo).title` 导出标题：
`https://www.zhihu.com/question/35329107/answer/2726573615`。该代码只作为交叉参考，
最终契约以小米官网真实响应为准。

### 官方前端源码确认

| 方法 | 路径 | 参数或请求体 | 用途 |
| --- | --- | --- | --- |
| GET | `/note/full/folder` | `folderId`、`noteId`、`limit` | 分页读取指定文件夹 |
| GET | `/file/full/v2` | `type=note_img`、`fileid` | 获取 KSS 下载元数据（`secure_key`、`blocks[].urls`）；逐块下载并按 `secure_key` 做 RC4 传输解包后得到原始附件字节 |
| POST | `/note/note/:id` | 表单：`entry`（JSON 字符串） | 更新笔记 |
| POST | `/note/full/:id/delete` | 表单：`tag`、`purge` | 移入回收站或彻底删除 |
| POST | `/note/folder` | 表单：`entry` | 创建文件夹 |
| POST | `/note/folder/:id` | 表单：`entry` | 更新文件夹 |
| GET | `/note/full/history/times` | `id` | 查询历史版本时间 |
| GET | `/note/full/history` | `id`、`version` | 读取历史版本 |
| POST | `/note/note/:id/history` | `id`、`version` | 恢复历史版本 |

小米请求包装器会自动附加认证字段。适配器不得自行读取或持久化认证字段，而应在登录页面内通过 `page.evaluate()` 或 CDP `Runtime.evaluate` 发起同源请求。

## vivo 原子笔记

网页入口：`https://pc.vivo.com.cn/suite?origin=cloudWeb#/note`

当前前端构建：`app-modules-note_94b6ccdf.js`

所有笔记服务请求在浏览器网络层使用 `/note-api` 前缀。

### 登录态实测

| 方法 | 浏览器路径 | 外层请求体键 | 用途 |
| --- | --- | --- | --- |
| POST | `/note-api/account/getConfig` | `openId` | 读取笔记账号配置 |
| POST | `/note-api/sync/getSyncState` | `type` | 获取同步状态 |
| POST | `/note-api/device/getList` | `newVersionDevice`、`vaid` | 获取设备列表 |
| POST | `/note-api/note/getAllNote/v2` | `jvq_param` | 分页读取笔记列表 |
| POST | `/note-api/noteBook/getList` | `maxEntries` | 读取笔记本列表 |
| POST | `/note-api/statistics/note` | `encryptType`、`type` | 获取笔记统计 |
| POST | `/note-api/note/getContent/v2` | `jvq_param` | 读取单条正文 |
| POST | `/note-api/history/note/list/v2` | `jvq_param` | 读取历史版本列表 |

`jvq_param` 由当前官方前端的模块 `920` 生成。该模块按环境选择配置并暴露为 `window.VNoteServerMaodun`；适配器在已登录页面上下文中调用 `window.VNoteServerMaodun.encrypt(JSON.stringify(payload)).data`。适配器不复制密钥、不在 Node 侧实现加密算法，也不保存密文。

### 图片附件上传链路

官方网页模块 `324`（`FileUpload`）负责上传图片。适配器必须调用该模块，避免读取或持久化网页会话中的 `openId`、STS token 或上传域名凭据。模块执行的顺序为：

1. `POST /api/suite/web/meta/preUpload.do`：传入文件名、大小、校验和、图片元信息，取得 `metaId`、上传域名和分片策略。
2. 上传原始图片到返回域名的 `/api/file/webdisk/upload.do`（或分片接口），完成后由模块确认上传。
3. 把返回的 `metaId` 映射为同步资源的 `resourceKey` 和 `fileID`，并将资源与创建笔记请求一起提交。图片正文引用使用 `vnote-image` 的资源 `guid`。

当前代码只允许图像附件走该路径。上传失败会使该条笔记进入失败记录，不会创建一个声称已含附件的半成品笔记。

### 官方前端源码确认

| 方法 | 业务路径（网络层加 `/note-api`） | 前端调用名 | 用途 |
| --- | --- | --- | --- |
| POST | `/note/getNoteForNoteBook` | `note_getNoteForNoteBook` | 按笔记本读取笔记 |
| POST | `/note/getIncludeItem/v2` | `note_getSingeNote` | 读取笔记及关联项 |
| POST | `/note/update/v2` | `note_updateNote` | 更新笔记或笔记本归属 |
| POST | `/note/expunge` | `note_deleteNote` | 删除笔记 |
| POST | `/service/getRecentlyDeleted/v2` | `note_getRecentlyDeleted` | 读取最近删除 |
| POST | `/service/recover` | `note_recover` | 恢复笔记 |
| POST | `/noteBook/create` | `note_createNoteBook` | 创建笔记本 |
| POST | `/noteBook/update` | `note_updateNoteBook` | 更新笔记本 |
| POST | `/noteBook/expungeCascade` | `note_expungeNoteBook` | 删除笔记本及内容 |
| POST | `/sync/createSync/v2` | `createSync` | 创建同步记录 |
| POST | `/sync/updateSync/v2` | `updateSync` | 更新同步记录 |
| POST | `/sync/deleteSync` | `deleteSync` | 删除同步记录 |
| POST | `/sync/combineSync/v2` | `combineSync` | 合并同步记录 |
| POST | `/sync/getSyncChunk/v2` | `getSyncChunk` | 获取增量同步数据 |
| POST | `/history/note/detail/v2` | 无 | 读取历史版本正文 |
| POST | `/history/note/delete` | 无 | 删除历史版本 |
| POST | `/note/:format/export/v2` | 无 | 导出单条笔记；`format` 由页面导出选项决定 |

vivo 网页还定义了本地同步桥调用：`note_insertNote`、`note_pc_updateNote`、`note_findNotes`、`note_findResources`。这些调用的 `url` 为空，不能当作 HTTP 端点；它们由网页同步层再映射到 `/sync/*` 或 `/note/*`。实现时必须复用同步层契约，不能把空路径调用硬编码为网络请求。

## 适配器调用规则

1. Playwright 负责打开可见登录窗口和维持浏览器上下文。
2. 批量读取、创建和更新使用同源脚本调用，不逐条点击网页控件。
3. 契约层只记录字段名和类型；运行日志不得记录请求值、响应值、标题、正文或附件名。
4. 认证失效、验证码和限流必须转化为明确的适配器错误，不得静默重试登录。
5. 每次厂商网页构建哈希变化时，先运行契约冒烟测试，再允许执行真实迁移。

## 当前验证缺口

- 小米附件下载已在真实登录态验证：`/file/full` 当前返回 `HWPENKITDATA` 包装，不能当图片直接保存；`/file/full/v2` 返回 KSS 元数据，下载 block 并解包后得到标准 JPEG/PNG 等原始附件。更新、删除和文件夹仍只有源码验证。
- vivo `createSync` 创建、`getNote` 回验和 `deleteNote` 删除已使用无敏感合成笔记完成登录态网络验证。更新、笔记本创建和图片上传仍只有源码验证。
- 真实写入验证必须只使用无敏感合成笔记，并在完成后通过接口删除。
