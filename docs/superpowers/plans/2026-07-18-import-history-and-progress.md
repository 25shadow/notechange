# Import History and Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live vivo-import progress and durable failed-note details, while preserving import history across restarts and opening each provider's note center through its authenticated profile.

**Architecture:** The orchestrator emits typed snapshots. `FileImportHistoryStore` persists a versioned record before, during, and after the import; `MigrationRuntime` maps snapshots into history updates and IPC progress events. The renderer subscribes through preload and renders active progress plus a durable import-history detail view.

**Tech Stack:** Electron IPC, TypeScript, React, Zod, Vitest, Testing Library

---

### Task 1: Define Import History and Progress Contracts

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/migration/orchestrator.ts`
- Modify: `tests/integration/orchestrator.test.ts`

- [ ] **Step 1: Write a failing observer-order test**

```ts
it('emits progress for each import outcome', async () => {
  const snapshots: MigrationProgress[] = [];
  const report = await orchestrator.importToTarget(bundle, (snapshot) => snapshots.push(snapshot));

  expect(report).toMatchObject({ created: 1, failed: 1 });
  expect(snapshots.at(-1)).toMatchObject({ total: 2, completed: 2, created: 1, failed: 1 });
  expect(snapshots.map((snapshot) => snapshot.current?.outcome)).toEqual(['created', 'failed']);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- tests/integration/orchestrator.test.ts -t "emits progress"`

Expected: FAIL because `importToTarget` has no observer argument.

- [ ] **Step 3: Define shared history and progress types, then emit snapshots**

Add these shared IPC types:

```ts
export type ImportOutcome = 'created' | 'skipped' | 'failed' | 'manual-review';
export type ImportTaskStatus = 'running' | 'completed' | 'completed-with-issues' | 'cancelled' | 'failed-to-start';
export type ImportProgress = {
  taskId: string;
  total: number;
  completed: number;
  created: number;
  skipped: number;
  failed: number;
  manualReview: number;
  current: { sourceId: string; title: string; outcome?: ImportOutcome; errorCode?: string } | null;
  occurredAt: string;
};
export type MigrationProgress = Omit<ImportProgress, 'taskId'>;
export type ImportFailure = { sourceId: string; title: string; outcome: 'failed' | 'manual-review'; errorCode: string; message: string; occurredAt: string };
```

Update `MigrationOrchestrator.importToTarget` to accept an optional `(snapshot: MigrationProgress) => void` observer and emit a snapshot after each skipped, created, failed, or manual-review outcome. `MigrationRuntime` assigns its generated task ID when it persists or forwards the snapshot. Use `note.title || '无标题'`, never note body. Keep the returned `MigrationReport` unchanged.

- [ ] **Step 4: Verify the orchestrator tests pass**

Run: `npm test -- tests/integration/orchestrator.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract and observer work**

Run: `git add src/shared/ipc.ts src/main/migration/orchestrator.ts tests/integration/orchestrator.test.ts && git commit -m "feat: report import progress"`

### Task 2: Persist Versioned Import History

**Files:**
- Create: `src/main/storage/import-history-store.ts`
- Create: `src/main/storage/import-history-root.ts`
- Create: `tests/unit/import-history-store.test.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write failing store tests**

```ts
it('writes updates atomically and reloads history newest first', async () => {
  const store = new FileImportHistoryStore(root);
  await store.create(fixtureTask('task-old', '2026-07-18T10:00:00.000Z'));
  await store.create(fixtureTask('task-new', '2026-07-18T11:00:00.000Z'));
  await store.appendProgress('task-new', fixtureProgress('task-new', 1));

  expect((await store.list()).map((task) => task.taskId)).toEqual(['task-new', 'task-old']);
  expect((await store.get('task-new'))?.progress.completed).toBe(1);
});
```

Add tests proving one corrupt JSON record is omitted while other records remain listed, and that `appendFailure` stores only the passed failure fields.

- [ ] **Step 2: Verify store tests fail**

Run: `npm test -- tests/unit/import-history-store.test.ts`

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement the validated file store**

Create `FileImportHistoryStore` with `create`, `appendProgress`, `appendFailure`, `complete`, `list`, and `get`. Persist one Zod-validated schema-version-1 JSON file per task under `importHistoryRoot(app.getPath('userData'))`, use a `0600` temporary file plus rename for each update, sort summaries by descending `startedAt`, and omit corrupt task files from `list`.

The public record shape is:

```ts
export type StoredImportTask = {
  schemaVersion: 1;
  taskId: string;
  batchId: string;
  source: 'xiaomi';
  target: 'vivo';
  status: ImportTaskStatus;
  startedAt: string;
  completedAt: string | null;
  progress: ImportProgress;
  logs: Array<{ occurredAt: string; message: string; kind: 'info' | 'success' | 'error' }>;
  failures: ImportFailure[];
};
```

Wire the store into `MigrationRuntime` construction in `src/main/index.ts`.

- [ ] **Step 4: Verify persistence tests pass**

Run: `npm test -- tests/unit/import-history-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit history persistence**

Run: `git add src/main/storage/import-history-store.ts src/main/storage/import-history-root.ts tests/unit/import-history-store.test.ts src/main/index.ts && git commit -m "feat: persist import history"`

### Task 3: Connect Runtime, IPC, and Provider Note Centers

**Files:**
- Modify: `src/main/runtime/migration-runtime.ts`
- Modify: `src/main/runtime/ipc-handlers.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `tests/unit/ipc-handlers.test.ts`
- Modify: `tests/unit/migration-runtime.test.ts`

- [ ] **Step 1: Write failing runtime tests**

```ts
it('persists progress and failures while importing', async () => {
  await runtime.confirmMigration();
  await runtime.startImport(onProgress);

  expect(history.create).toHaveBeenCalledOnce();
  expect(history.appendProgress).toHaveBeenCalled();
  expect(history.appendFailure).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ outcome: 'failed' }));
  expect(history.complete).toHaveBeenCalledWith(expect.any(String), 'completed-with-issues', expect.anything());
});

it('opens a provider note center through the headed session', async () => {
  await runtime.openNoteCenter('vivo');
  expect(sessionManager.switchToHeaded).toHaveBeenCalledWith('vivo', 'https://pc.vivo.com.cn/suite?origin=cloudWeb#/note');
});
```

- [ ] **Step 2: Verify runtime tests fail**

Run: `npm test -- tests/unit/migration-runtime.test.ts -t "persists progress|opens a provider"`

Expected: FAIL because runtime has neither method/behavior.

- [ ] **Step 3: Implement runtime methods and IPC event forwarding**

Add `ImportHistoryStore` to `MigrationRuntimeOptions`. `startImport(onProgress?)` creates the task ID before import, maps observer snapshots to `appendProgress`, appends a readable event log, appends failures/manual reviews, finalizes status, and invokes `onProgress` after persistence. Add `listImportHistory`, `getImportHistory`, and `openNoteCenter(provider)` methods.

`openNoteCenter` calls `switchToHeaded` when a page exists and `open(provider, url, 'headed')` otherwise. Add `openNoteCenter`, `listImportHistory`, `getImportHistory`, and `importProgress` IPC channel names; IPC handlers validate provider input and send `importProgress` through `event.sender.send`. Preload must expose `onImportProgress(listener)` and return an unsubscribe closure.

- [ ] **Step 4: Verify runtime and IPC tests pass**

Run: `npm test -- tests/unit/migration-runtime.test.ts tests/unit/ipc-handlers.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit runtime and IPC work**

Run: `git add src/main/runtime/migration-runtime.ts src/main/runtime/ipc-handlers.ts src/main/preload.ts src/shared/ipc.ts tests/unit/migration-runtime.test.ts tests/unit/ipc-handlers.test.ts && git commit -m "feat: expose import history and note centers"`

### Task 4: Render Import Progress and History

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Create: `src/renderer/ImportHistoryDialog.tsx`
- Modify: `tests/unit/app-smoke.test.tsx`
- Create: `tests/unit/import-history-dialog.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

```tsx
it('renders live import progress from the IPC subscription', async () => {
  const api = fakeApi({ onImportProgress: (listener) => { listener(fixtureProgress('task-1', 3)); return () => undefined; } });
  render(<App api={api} />);

  expect(await screen.findByText('3 / 10')).toBeTruthy();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
});

it('lists failed notes in an import history detail', async () => {
  render(<ImportHistoryDialog api={api} taskId="task-1" onClose={() => undefined} />);
  expect(await screen.findByText('同步失败的笔记')).toBeTruthy();
});
```

- [ ] **Step 2: Verify renderer tests fail**

Run: `npm test -- tests/unit/import-history-dialog.test.tsx`

Expected: FAIL because the history dialog does not exist.

- [ ] **Step 3: Implement active progress and durable history UI**

Extend `App` to subscribe/unsubscribe to `api.onImportProgress`, show a modal progress surface while importing (counter, current safe title, per-outcome counts, logs, cancel control), and replace the picker after import begins. Add a full-width import-history section below export batches with a compact list and an icon-only details action. `ImportHistoryDialog` loads detail data and renders summary, chronological logs, and a failure/manual-review table.

Add a `FolderOpen` Lucide icon button to authenticated Xiaomi/vivo cards. It calls `api.openNoteCenter(provider)`, disables while opening, and has an accessible label and tooltip. Use existing restrained panel and dialog styles; no nested cards.

- [ ] **Step 4: Verify renderer tests pass**

Run: `npm test -- tests/unit/app-smoke.test.tsx tests/unit/import-history-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit renderer work**

Run: `git add src/renderer/App.tsx src/renderer/styles.css src/renderer/ImportHistoryDialog.tsx tests/unit/app-smoke.test.tsx tests/unit/import-history-dialog.test.tsx && git commit -m "feat: show import progress and history"`

### Task 5: Full Regression Verification

**Files:**
- Verify: `tests/integration/orchestrator.test.ts`
- Verify: `tests/unit/import-history-store.test.ts`
- Verify: `tests/unit/migration-runtime.test.ts`
- Verify: `tests/unit/ipc-handlers.test.ts`
- Verify: `tests/unit/import-history-dialog.test.tsx`

- [ ] **Step 1: Run targeted feature tests**

Run: `npm test -- tests/integration/orchestrator.test.ts tests/unit/import-history-store.test.ts tests/unit/migration-runtime.test.ts tests/unit/ipc-handlers.test.ts tests/unit/import-history-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run typechecking and full test suite**

Run: `npm run typecheck && npm test`

Expected: both commands exit `0`.

- [ ] **Step 3: Inspect final changes**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intentional feature files are changed before their commits.
