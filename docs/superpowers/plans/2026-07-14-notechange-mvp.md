# NoteChange 双向笔记迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地 Electron 桌面应用，通过 Playwright 登录会话和已保存的接口契约，在小米云笔记与 vivo 原子笔记之间双向迁移标题、正文、文件夹、图片附件和时间字段。

**Architecture:** React 渲染进程负责四步迁移向导，Electron 主进程负责 Playwright、契约驱动的厂商适配器、内容转换、加密任务快照和迁移编排。批量数据操作全部使用同源脚本接口，不逐条点击网页；每次写入后保存检查点以保证幂等和断点恢复。

**Tech Stack:** Electron、React、TypeScript、Vite、Playwright、Vitest、Testing Library、Zod、DOMPurify、Electron `safeStorage`、Node `crypto`、ESLint、Prettier。

---

## 文件结构

```text
package.json                         # 命令、依赖和打包配置
electron.vite.config.ts              # Electron/Vite 三进程构建
src/shared/domain.ts                 # 统一笔记模型和任务状态
src/shared/ipc.ts                    # 强类型 IPC 契约
src/main/index.ts                    # Electron 主进程入口
src/main/preload.ts                  # 最小化 renderer API
src/main/browser/session-manager.ts  # Playwright 持久上下文与登录状态
src/main/contracts/loader.ts         # 加载并校验 provider contract JSON
src/main/providers/provider.ts       # NotesProvider 接口
src/main/providers/xiaomi/*          # 小米 API、映射和适配器
src/main/providers/vivo/*            # vivo API、同步模型和适配器
src/main/migration/*                 # 内容转换、重复检测和任务编排
src/main/storage/*                   # 加密快照、检查点和清理
src/main/security/redact.ts          # 日志脱敏
src/renderer/*                       # 迁移向导、预览、进度、报告
tests/fixtures/*                     # 脱敏接口响应夹具
tests/unit/*                         # 纯逻辑测试
tests/integration/*                  # 适配器与编排器测试
tests/e2e/*                          # Electron 端到端测试
```

## Task 1：初始化 Electron、React 与测试工具链

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `src/main/index.ts`
- Create: `src/main/preload.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `tests/unit/app-smoke.test.tsx`

- [ ] **Step 1：初始化 Git 和 npm 项目**

Run:

```bash
git init
npm init -y
npm install react react-dom zod dompurify
npm install -D electron electron-vite playwright typescript vite vitest jsdom @vitejs/plugin-react @testing-library/react @testing-library/jest-dom @types/node @types/react @types/react-dom eslint prettier
```

Expected: 生成 `package-lock.json`，命令退出码为 `0`。

- [ ] **Step 2：先写失败的桌面壳测试**

```tsx
// tests/unit/app-smoke.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';

describe('App', () => {
  it('直接显示迁移工作区', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '笔记迁移' })).toBeTruthy();
  });
});
```

- [ ] **Step 3：运行测试并确认失败**

Run: `npx vitest run tests/unit/app-smoke.test.tsx`

Expected: FAIL，提示无法解析 `src/renderer/App`。

- [ ] **Step 4：实现最小桌面壳和命令**

```tsx
// src/renderer/App.tsx
export function App() {
  return <main><h1>笔记迁移</h1></main>;
}
```

在 `package.json` 中加入：

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 5：验证并提交**

Run: `npm test && npm run typecheck && npm run build`

Expected: 测试通过，主进程、preload 和 renderer 均构建成功。

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig.json src tests/unit/app-smoke.test.tsx
git commit -m "chore: scaffold NoteChange desktop app"
```

## Task 2：定义统一领域模型和适配器接口

**Files:**
- Create: `src/shared/domain.ts`
- Create: `src/main/providers/provider.ts`
- Create: `tests/unit/domain.test.ts`

- [ ] **Step 1：写统一模型校验测试**

```ts
// tests/unit/domain.test.ts
import { describe, expect, it } from 'vitest';
import { canonicalNoteSchema } from '../../src/shared/domain';

describe('canonicalNoteSchema', () => {
  it('拒绝缺少内容哈希的笔记', () => {
    const result = canonicalNoteSchema.safeParse({
      sourceId: 'n1', folderSourceId: null, title: '测试', html: '<p>正文</p>',
      plainText: '正文', attachments: [], createdAt: null, modifiedAt: null, warnings: []
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2：运行测试并确认失败**

Run: `npx vitest run tests/unit/domain.test.ts`

Expected: FAIL，提示 `canonicalNoteSchema` 不存在。

- [ ] **Step 3：实现领域模型**

```ts
// src/shared/domain.ts
import { z } from 'zod';

export const providerSchema = z.enum(['xiaomi', 'vivo']);
export type ProviderId = z.infer<typeof providerSchema>;

export const migrationWarningSchema = z.object({
  code: z.enum(['unsupported-content', 'encrypted-note', 'attachment-failed']),
  message: z.string()
});

export const canonicalAttachmentSchema = z.object({
  sourceId: z.string(), mimeType: z.string(), filename: z.string(),
  sha256: z.string().length(64), localPath: z.string()
});

export const canonicalNoteSchema = z.object({
  sourceId: z.string(), folderSourceId: z.string().nullable(), title: z.string(),
  html: z.string(), plainText: z.string(), attachments: z.array(canonicalAttachmentSchema),
  createdAt: z.string().datetime().nullable(), modifiedAt: z.string().datetime().nullable(),
  contentHash: z.string().length(64), warnings: z.array(migrationWarningSchema)
});

export type CanonicalNote = z.infer<typeof canonicalNoteSchema>;
export type Page<T> = { items: T[]; nextCursor: string | null };
```

```ts
// src/main/providers/provider.ts
import type { CanonicalNote, Page, ProviderId } from '../../shared/domain';

export type LoginState = { authenticated: boolean; accountLabel: string | null };
export type SourceFolder = { sourceId: string; parentSourceId: string | null; name: string };
export type SourceNoteSummary = { sourceId: string; folderSourceId: string | null };
export type SourceAttachment = { sourceId: string; mimeType: string; filename: string };
export type DownloadedAttachment = SourceAttachment & { localPath: string; sha256: string };
export type TargetNote = { targetId: string; modifiedAt: string | null };

export interface NotesProvider {
  readonly id: ProviderId;
  startLogin(): Promise<void>;
  getLoginState(): Promise<LoginState>;
  listFolders(cursor?: string): Promise<Page<SourceFolder>>;
  listNotes(cursor?: string): Promise<Page<SourceNoteSummary>>;
  getNote(sourceId: string): Promise<CanonicalNote>;
  downloadAttachment(attachment: SourceAttachment): Promise<DownloadedAttachment>;
  createFolder(folder: SourceFolder): Promise<{ targetId: string }>;
  upsertNote(note: CanonicalNote, targetFolderId: string | null): Promise<TargetNote>;
  dispose(): Promise<void>;
}
```

- [ ] **Step 4：运行测试和类型检查**

Run: `npm test -- tests/unit/domain.test.ts && npm run typecheck`

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add src/shared/domain.ts src/main/providers/provider.ts tests/unit/domain.test.ts
git commit -m "feat: define provider-neutral note model"
```

## Task 3：加载并强制校验接口契约

**Files:**
- Modify: `docs/research/contracts/xiaomi-notes.contract.json`
- Modify: `docs/research/contracts/vivo-notes.contract.json`
- Create: `src/main/contracts/schema.ts`
- Create: `src/main/contracts/loader.ts`
- Create: `tests/unit/contracts.test.ts`

- [ ] **Step 1：写契约加载失败测试**

```ts
// tests/unit/contracts.test.ts
import { describe, expect, it } from 'vitest';
import { parseProviderContract } from '../../src/main/contracts/loader';

describe('parseProviderContract', () => {
  it('拒绝没有验证等级的操作', () => {
    expect(() => parseProviderContract({ provider: 'xiaomi', operations: [{ name: 'x', method: 'GET', path: '/x' }] }))
      .toThrow();
  });
});
```

- [ ] **Step 2：运行测试并确认失败**

Run: `npx vitest run tests/unit/contracts.test.ts`

Expected: FAIL，提示模块不存在。

- [ ] **Step 3：实现 Zod 契约模型和加载器**

```ts
// src/main/contracts/schema.ts
import { z } from 'zod';

export const operationContractSchema = z.object({
  name: z.string(), method: z.enum(['GET', 'POST']), path: z.string().startsWith('/'),
  verification: z.enum(['network-verified', 'source-verified']),
  queryKeys: z.array(z.string()).optional(), bodyKeys: z.array(z.string()).optional(),
  wireBodyKeys: z.array(z.string()).optional(), bodyEncoding: z.enum(['form', 'json']).optional()
});

export const providerContractSchema = z.object({
  provider: z.enum(['xiaomi', 'vivo']), operations: z.array(operationContractSchema).min(1)
}).passthrough();
```

```ts
// src/main/contracts/loader.ts
import { providerContractSchema } from './schema';
export function parseProviderContract(value: unknown) { return providerContractSchema.parse(value); }

export function assertWriteVerified(operation: { name: string; verification: string }) {
  if (operation.verification !== 'network-verified') {
    throw new Error(`CONTRACT_WRITE_NOT_VERIFIED:${operation.name}`);
  }
}
```

- [ ] **Step 4：增加契约冒烟命令**

创建 `scripts/validate-contracts.mjs`，读取两个 JSON 并验证：操作名唯一、路径不含真实 ID、值中不存在 Cookie 或令牌。增加测试断言 `assertWriteVerified()` 拒绝所有 `source-verified` 写操作。命令：

```bash
node scripts/validate-contracts.mjs
```

Expected: 输出 `2 provider contracts valid`。

- [ ] **Step 5：验证并提交**

```bash
npm test -- tests/unit/contracts.test.ts
node scripts/validate-contracts.mjs
git add docs/research/contracts src/main/contracts scripts/validate-contracts.mjs tests/unit/contracts.test.ts
git commit -m "feat: validate provider API contracts"
```

## Task 4：实现内容清洗、哈希和重复检测

**Files:**
- Create: `src/main/migration/content.ts`
- Create: `src/main/migration/duplicates.ts`
- Create: `tests/unit/content.test.ts`
- Create: `tests/unit/duplicates.test.ts`

- [ ] **Step 1：写内容转换失败测试**

```ts
// tests/unit/content.test.ts
import { describe, expect, it } from 'vitest';
import { normalizeContent } from '../../src/main/migration/content';

it('移除脚本并保留段落和列表', () => {
  const out = normalizeContent('<p>正文</p><script>secret()</script><ul><li>A</li></ul>');
  expect(out.html).toBe('<p>正文</p><ul><li>A</li></ul>');
  expect(out.plainText).toContain('正文');
  expect(out.contentHash).toMatch(/^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2：运行测试并确认失败**

Run: `npx vitest run tests/unit/content.test.ts`

Expected: FAIL，提示 `normalizeContent` 不存在。

- [ ] **Step 3：实现转换器和重复规则**

`normalizeContent` 使用 DOMPurify 的 Node/JSDOM 环境，只允许 `p`、`br`、`strong`、`em`、`u`、`ul`、`ol`、`li`、`a`、`img`。哈希输入固定为规范化标题、HTML、附件 SHA-256 与文件夹路径。

```ts
// src/main/migration/duplicates.ts
export type DuplicatePolicy = 'skip' | 'copy' | 'overwrite';
export function isProbableDuplicate(a: { contentHash: string }, b: { contentHash: string }) {
  return a.contentHash === b.contentHash;
}
```

- [ ] **Step 4：覆盖不支持内容和重复策略**

新增测试：音频标签生成 `unsupported-content` 警告；同哈希返回重复；不同哈希不重复。

Run: `npx vitest run tests/unit/content.test.ts tests/unit/duplicates.test.ts`

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add src/main/migration tests/unit/content.test.ts tests/unit/duplicates.test.ts
git commit -m "feat: normalize notes and detect duplicates"
```

## Task 5：实现加密任务快照与检查点

**Files:**
- Create: `src/main/storage/protector.ts`
- Create: `src/main/storage/encrypted-file.ts`
- Create: `src/main/storage/task-store.ts`
- Create: `tests/unit/task-store.test.ts`

- [ ] **Step 1：写恢复测试**

测试创建三条任务项，将第一条标记完成，重新打开存储后只返回其余两条；同时断言磁盘文件不包含标题或正文。

- [ ] **Step 2：运行测试并确认失败**

Run: `npx vitest run tests/unit/task-store.test.ts`

Expected: FAIL，提示 `TaskStore` 不存在。

- [ ] **Step 3：实现密钥保护和 AES-256-GCM 文件格式**

```ts
// src/main/storage/protector.ts
export interface SecretProtector { protect(value: Buffer): Buffer; unprotect(value: Buffer): Buffer; }
```

文件头固定为 `NOTECHANGE1`，后接 12 字节 IV、16 字节认证标签和密文。生产实现用 Electron `safeStorage` 包装随机 32 字节数据密钥；测试实现使用进程内固定密钥。

- [ ] **Step 4：实现原子检查点写入**

`TaskStore.save()` 先写 `task.tmp`，`fsync` 后重命名为 `task.enc`。任务项状态仅允许 `pending -> running -> created|skipped|failed|manual-review`。

Run: `npx vitest run tests/unit/task-store.test.ts`

Expected: PASS，测试目录中没有明文内容。

- [ ] **Step 5：提交**

```bash
git add src/main/storage tests/unit/task-store.test.ts
git commit -m "feat: persist encrypted migration checkpoints"
```

## Task 6：实现 Playwright 登录会话与同源脚本执行器

**Files:**
- Create: `src/main/browser/session-manager.ts`
- Create: `src/main/browser/same-origin-executor.ts`
- Create: `src/main/security/redact.ts`
- Create: `tests/integration/session-manager.test.ts`
- Create: `tests/unit/redact.test.ts`

- [ ] **Step 1：写脚本执行器测试**

使用本地测试服务器设置一个 HttpOnly 会话 Cookie，断言同源执行器能请求 `/api/me`，但返回日志中不出现 Cookie 值。

- [ ] **Step 2：运行测试并确认失败**

Run: `npx vitest run tests/integration/session-manager.test.ts tests/unit/redact.test.ts`

Expected: FAIL，提示 `SessionManager` 不存在。

- [ ] **Step 3：实现持久浏览器上下文**

```ts
// src/main/browser/session-manager.ts
import { chromium, type BrowserContext, type Page } from 'playwright';

export class SessionManager {
  private contexts = new Map<string, BrowserContext>();
  async open(provider: string, url: string): Promise<Page> {
    const context = await chromium.launchPersistentContext('', { headless: false });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    this.contexts.set(provider, context);
    return page;
  }
  async disposeAll() { await Promise.all([...this.contexts.values()].map(c => c.close())); this.contexts.clear(); }
}
```

实现时将空 `userDataDir` 替换为任务临时目录，任务完成后递归删除；不得调用 `context.storageState({ path })`。

- [ ] **Step 4：实现契约驱动的同源调用**

`SameOriginExecutor` 接收操作名和脱敏参数，在 `page.evaluate()` 内调用 `fetch`。小米请求使用表单编码；vivo 请求通过页面当前官方包装函数生成 `jvq_param`。执行器只返回解析后的业务响应，不返回响应头或 Cookie。

```ts
import type { Page } from 'playwright';

export async function runSameOrigin<T>(page: Page, path: string, init: RequestInit): Promise<T> {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, { ...init, credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.json();
  }, { path, init });
}
```

- [ ] **Step 5：验证并提交**

```bash
npm test -- tests/integration/session-manager.test.ts tests/unit/redact.test.ts
git add src/main/browser src/main/security tests/integration/session-manager.test.ts tests/unit/redact.test.ts
git commit -m "feat: manage authenticated Playwright sessions"
```

## Task 7：实现小米契约适配器

**Files:**
- Create: `src/main/providers/xiaomi/xiaomi-api.ts`
- Create: `src/main/providers/xiaomi/xiaomi-mapper.ts`
- Create: `src/main/providers/xiaomi/xiaomi-provider.ts`
- Create: `tests/fixtures/xiaomi/*.json`
- Create: `tests/integration/xiaomi-provider.test.ts`

- [ ] **Step 1：从脱敏响应建立夹具测试**

覆盖：两页列表、单条正文、文件夹、图片、创建成功、更新成功、401、限流和格式错误。测试断言分页游标只取 `syncTag`，图片只允许 `type=note_img`。

- [ ] **Step 2：运行测试并确认失败**

Run: `npx vitest run tests/integration/xiaomi-provider.test.ts`

Expected: FAIL，提示 `XiaomiProvider` 不存在。

- [ ] **Step 3：实现 API 层**

API 层只可通过 `xiaomi-notes.contract.json` 查找操作，不允许散落字符串路径：

```ts
const op = contract.operations.find(item => item.name === 'listNotes');
if (!op) throw new Error('CONTRACT_OPERATION_MISSING:listNotes');
```

实现 `listNotes`、`getNote`、`downloadImage`、`createFolder`、`createNote`、`updateNote`。认证字段由网页上下文自动处理，TypeScript 参数不得包含 `serviceToken`。`createFolder`、`updateNote` 等写操作调用前必须经过 `assertWriteVerified()`；未完成契约冒烟验证时应用只允许扫描和预览。

- [ ] **Step 4：实现字段映射**

将小米 `content` 转为规范 HTML；`folderId` 映射统一文件夹；`createDate`/`modifyDate` 从毫秒转换 ISO 时间；`encryptInfo` 存在时标记 `encrypted-note` 并禁止自动写入。

Run: `npx vitest run tests/integration/xiaomi-provider.test.ts`

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add src/main/providers/xiaomi tests/fixtures/xiaomi tests/integration/xiaomi-provider.test.ts
git commit -m "feat: add Xiaomi Cloud Notes adapter"
```

## Task 8：实现 vivo 同步契约适配器

**Files:**
- Modify: `docs/research/contracts/vivo-notes.contract.json`
- Create: `src/main/providers/vivo/vivo-sync-types.ts`
- Create: `src/main/providers/vivo/vivo-api.ts`
- Create: `src/main/providers/vivo/vivo-mapper.ts`
- Create: `src/main/providers/vivo/vivo-provider.ts`
- Create: `tests/fixtures/vivo/*.json`
- Create: `tests/integration/vivo-provider.test.ts`

- [ ] **Step 1：写 vivo 创建同步测试**

```ts
class FakeExecutor {
  calls: Array<{ operation: string; payload: unknown }> = [];
  async call(operation: string, payload: unknown) {
    this.calls.push({ operation, payload });
    if (operation === 'getSyncState') return { updateCount: 7 };
    if (operation === 'createSync') return { updateCount: 8, notes: [{ guid: 'target-1' }] };
    throw new Error(`UNEXPECTED_OPERATION:${operation}`);
  }
}

it('使用 createSync 创建普通笔记', async () => {
  const fakeExecutor = new FakeExecutor();
  const provider = new VivoProvider(fakeExecutor);
  const canonicalNote = {
    sourceId: 'source-1', folderSourceId: null, title: '合成笔记',
    html: '<p>仅用于测试</p>', plainText: '仅用于测试', attachments: [],
    createdAt: '2026-07-14T00:00:00.000Z', modifiedAt: '2026-07-14T00:00:00.000Z',
    contentHash: 'a'.repeat(64), warnings: []
  };
  const result = await provider.upsertNote(canonicalNote, '0');
  expect(fakeExecutor.calls[0]).toMatchObject({ operation: 'getSyncState' });
  expect(fakeExecutor.calls[1]).toMatchObject({
    operation: 'createSync',
    payload: { type: 0, noteBooks: [], tags: [], resources: [] }
  });
  expect(result.targetId).toBeTruthy();
});
```

- [ ] **Step 2：运行测试并确认失败**

Run: `npx vitest run tests/integration/vivo-provider.test.ts`

Expected: FAIL，提示 `VivoProvider` 不存在。

- [ ] **Step 3：实现官方同步请求结构**

```ts
// src/main/providers/vivo/vivo-sync-types.ts
export type VivoSyncNote = {
  guid: string; title: string; contentDigest: string; content: string;
  conflictTime: null; createTime: number; updateTime: number;
  contentUpdateTime: number; attrUpdateTime: number; importantLevel: 0;
  noteBookGuid: string; tags: []; deleted: 1; dirty: 1; type: 1;
  contentLoaded: true; symbolCnf: ''; paperTexture: '0'; bgColor: 101;
  pageMargins: string; syncProtocolVersion: 0; isAiNote: 0; aiQuery: '';
};

export type VivoCreateSyncRequest = {
  type: 0; lastUpdateCount: number; noteBooks: []; notes: VivoSyncNote[];
  tags: []; resources: [];
};
```

先调用 `getSyncState(0)` 获取 `updateCount`，再以 `lastUpdateCount` 调用 `/sync/createSync/v2`。更新使用 `/note/update/v2`；删除使用 `/note/expunge`。所有网络路径由契约 JSON 解析。三项写操作均先调用 `assertWriteVerified()`，否则返回 `CONTRACT_WRITE_NOT_VERIFIED`。

- [ ] **Step 4：实现 `jvq_param` 包装边界**

在 `vivo-api.ts` 中把官方前端包装器封装为 `VivoEnvelopeClient`。包装器仅存在于页面上下文；Node 侧只传普通合成业务对象，不读取密钥、不保存密文：

```ts
// src/main/providers/vivo/vivo-api.ts
import type { Page } from 'playwright';

declare global {
  interface Window {
    VNoteServerMaodun?: { encrypt(value: string): { data: string } };
  }
}

export async function vivoPost<T>(page: Page, path: string, payload: unknown): Promise<T> {
  return page.evaluate(async ({ path, payload }) => {
    const encoder = window.VNoteServerMaodun;
    if (!encoder) throw new Error('VIVO_ENVELOPE_UNAVAILABLE');
    const jvqParam = encoder.encrypt(JSON.stringify(payload)).data;
    const response = await fetch(`/note-api${path}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jvq_param: jvqParam })
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.json();
  }, { path, payload });
}
```

契约测试断言网络外层只有 `jvq_param`，日志中不出现其值。对于登录态实测显示为普通 JSON 字段的操作（例如 `noteBook/getList`），按契约的 `wireBodyKeys` 直接发送，不强制套用 `jvq_param`。

Run: `npx vitest run tests/integration/vivo-provider.test.ts`

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add docs/research/contracts/vivo-notes.contract.json src/main/providers/vivo tests/fixtures/vivo tests/integration/vivo-provider.test.ts
git commit -m "feat: add vivo Atomic Notes adapter"
```

## Task 9：实现迁移编排、幂等和断点恢复

**Files:**
- Create: `src/main/migration/orchestrator.ts`
- Create: `src/main/migration/retry.ts`
- Create: `tests/integration/orchestrator.test.ts`

- [ ] **Step 1：写双向迁移测试**

使用两个内存适配器，覆盖：小米到 vivo、vivo 到小米、重复任务跳过、第二条失败后恢复、取消后不继续写入。

- [ ] **Step 2：运行测试并确认失败**

Run: `npx vitest run tests/integration/orchestrator.test.ts`

Expected: FAIL，提示 `MigrationOrchestrator` 不存在。

- [ ] **Step 3：实现检查点驱动状态机**

编排顺序固定为：读取文件夹、读取摘要、读取完整笔记、生成预览、等待确认、创建文件夹、逐条写入、生成报告、清理会话。每条成功后立即 `TaskStore.save()`。

- [ ] **Step 4：实现错误分类和重试**

只对 `NETWORK_TRANSIENT` 和 `RATE_LIMITED` 重试，间隔为 1、2、4、8 秒，最多四次。`AUTH_EXPIRED`、`CAPTCHA_REQUIRED`、`ENCRYPTED_NOTE` 立即暂停或转人工处理。

Run: `npx vitest run tests/integration/orchestrator.test.ts`

Expected: PASS，重复执行不会增加目标端条目数。

- [ ] **Step 5：提交**

```bash
git add src/main/migration tests/integration/orchestrator.test.ts
git commit -m "feat: orchestrate resumable bidirectional migrations"
```

## Task 10：实现强类型 IPC 和四步迁移界面

**Files:**
- Create: `src/shared/ipc.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/components/*.tsx`
- Create: `src/renderer/styles.css`
- Create: `tests/unit/migration-wizard.test.tsx`

- [ ] **Step 1：写用户流程测试**

测试选择“小米到 vivo”、两个登录状态、预览数量和警告、确认对话框、迁移进度和最终报告。断言未确认前“开始迁移”按钮禁用。

- [ ] **Step 2：运行测试并确认失败**

Run: `npx vitest run tests/unit/migration-wizard.test.tsx`

Expected: FAIL，迁移向导不存在。

- [ ] **Step 3：实现最小 IPC 面**

renderer 只能调用：`startLogin`、`getLoginState`、`scan`、`confirmMigration`、`cancelMigration`、`resumeMigration`、`getReport`。事件只包含计数、阶段、脱敏条目 ID 和错误分类。

- [ ] **Step 4：实现四步向导**

界面步骤为“选择方向、登录、预览、迁移”。预览展示新增、重复、警告和附件数量；第一次写入前确认目标账号、数量、重复策略和“不会删除来源笔记”。

Run: `npx vitest run tests/unit/migration-wizard.test.tsx`

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add src/shared/ipc.ts src/main/index.ts src/main/preload.ts src/renderer tests/unit/migration-wizard.test.tsx
git commit -m "feat: add migration desktop workflow"
```

## Task 11：完成安全、端到端和打包验证

**Files:**
- Create: `tests/security/no-plaintext.test.ts`
- Create: `tests/e2e/migration.spec.ts`
- Create: `scripts/contract-smoke.ts`
- Create: `README.md`
- Modify: `package.json`

- [ ] **Step 1：写明文泄漏测试**

以唯一哨兵字符串作为标题、正文、附件名、Cookie 和令牌，运行完整夹具迁移后递归扫描日志、报告、临时目录和异常对象；任何位置出现哨兵字符串即失败。

- [ ] **Step 2：运行安全测试并确认失败**

Run: `npx vitest run tests/security/no-plaintext.test.ts`

Expected: 在脱敏和清理钩子完成前 FAIL。

- [ ] **Step 3：实现契约冒烟脚本**

`scripts/contract-smoke.ts` 只使用专用测试账号，验证两个站点的登录态、列表、单条读取，以及合成笔记的创建、更新、删除。脚本输出操作名和状态，不输出任何请求或响应值。只有创建、更新、读取回验和删除全部成功后，脚本才把对应 JSON 操作从 `source-verified` 提升为 `network-verified` 并写入实际观察到的字段名；任一步失败都保持原等级。厂商构建哈希变化时返回非零退出码。

- [ ] **Step 4：运行完整验证**

```bash
npm test
npm run typecheck
npm run build
npx playwright test tests/e2e/migration.spec.ts
node scripts/validate-contracts.mjs
```

Expected: 全部通过；Electron 应用在桌面端打开；迁移任务结束后 Playwright 临时目录被删除。

- [ ] **Step 5：补充文档并提交**

README 必须说明：支持范围、登录方式、本地数据位置、如何清理任务、为何接口可能随厂商网页变化、如何运行契约冒烟测试。

```bash
git add README.md package.json scripts tests/security tests/e2e
git commit -m "test: verify secure end-to-end migrations"
```

## 完成定义

- 小米到 vivo、vivo 到小米都能迁移支持的笔记和图片。
- 数据操作通过契约驱动的同源脚本执行，不逐条点击网页控件。
- 重复运行默认不产生副本，中断后可以恢复。
- 不支持内容进入人工处理报告，不静默丢失。
- 来源端笔记不被修改或删除。
- 日志、崩溃信息和持久化报告不包含凭据、标题、正文或附件名。
- 两份契约 JSON 均通过结构校验，网页构建版本变化会阻止真实迁移。
