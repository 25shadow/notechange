# Local Xiaomi Export Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save complete Xiaomi export batches with attachments under Electron userData and provide a searchable, safe preview dialog that survives application restarts.

**Architecture:** A file-backed `ExportBundleStore` atomically serializes canonical notes and copies deduplicated attachments into batch directories. `MigrationRuntime` saves new bundles, lazily restores the latest bundle, and exposes paged preview/detail methods through typed IPC. A dedicated React dialog renders only plain text and base64 image data returned by the main process.

**Tech Stack:** Electron, TypeScript, Node.js filesystem APIs, Zod, React, Vitest, Testing Library

---

### Task 1: File-backed export bundle store

**Files:**
- Create: `src/main/storage/export-bundle-store.ts`
- Create: `src/main/storage/file-export-bundle-store.ts`
- Create: `tests/unit/file-export-bundle-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Create a synthetic bundle with two notes that reference the same attachment SHA-256. Assert `save()` creates one attachment file, `manifest.json`, `notes.json`, and `latest.json`; assert `loadLatest()` restores both notes with valid absolute attachment paths. Add corrupt JSON and missing attachment cases that reject with `LOCAL_EXPORT_INVALID`.

```ts
const saved = await store.save(bundle);
expect(saved.noteCount).toBe(2);
expect(await readdir(join(root, saved.batchId, 'attachments'))).toHaveLength(1);
await expect(store.loadLatest()).resolves.toMatchObject({ notes: [{ sourceId: 'n1' }] });
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/unit/file-export-bundle-store.test.ts --reporter=verbose`

Expected: FAIL because the store modules do not exist.

- [ ] **Step 3: Define the store contract**

```ts
export type StoredExportBundle = {
  batchId: string;
  exportedAt: string;
  bundle: ExportBundle;
};

export interface ExportBundleStore {
  save(bundle: ExportBundle): Promise<StoredExportBundle>;
  loadLatest(): Promise<StoredExportBundle | null>;
  readAttachment(batchId: string, relativePath: string): Promise<Uint8Array>;
}
```

- [ ] **Step 4: Implement atomic storage**

Use `mkdir`, `copyFile`, `writeFile`, `rename`, `readFile`, `rm`, `realpath`, and Zod schemas. Write into `<batchId>.tmp`, use SHA-256 filenames with MIME extensions, rewrite attachment `localPath` to `attachments/<hash>.<ext>`, rename the completed directory, then atomically update `latest.json`. Create JSON and copied files with mode `0600` and directories with mode `0700`.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npx vitest run tests/unit/file-export-bundle-store.test.ts --reporter=verbose`

Expected: all store tests pass.

```bash
git add src/main/storage/export-bundle-store.ts src/main/storage/file-export-bundle-store.ts tests/unit/file-export-bundle-store.test.ts
git commit -m "feat: persist complete Xiaomi export batches"
```

### Task 2: Runtime preview and latest-batch restoration

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/runtime/migration-runtime.ts`
- Modify: `tests/unit/migration-runtime.test.ts`

- [ ] **Step 1: Add failing runtime tests**

Extend the runtime fixture with a memory `ExportBundleStore`. Assert `scanXiaomi()` calls `save()`, `getLatestExportSummary()` restores a bundle in a new runtime, preview search matches title/body, filters select warnings/attachments, paging respects offset/limit, detail omits HTML/local paths, and attachment reads return a base64 payload.

```ts
await expect(runtime.getExportPreview({ search: '合成', filter: 'all', offset: 0, limit: 50 }))
  .resolves.toMatchObject({ total: 1, items: [{ sourceId: 'synthetic-1' }] });
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/unit/migration-runtime.test.ts --reporter=verbose`

Expected: FAIL because the store option and preview methods do not exist.

- [ ] **Step 3: Add shared preview types**

Add `LocalExportSummary`, `ExportPreviewFilter`, `ExportPreviewQuery`, `ExportPreviewItem`, `ExportPreviewPage`, `ExportPreviewDetail`, and `ExportAttachmentData` to `src/shared/ipc.ts`. Extend `NoteChangeApi` with four read methods.

- [ ] **Step 4: Implement save, restore, search, detail, and attachment methods**

Add `exports: ExportBundleStore` to runtime options. Persist after `exportProviderNotes()`. Implement a private `ensureBundle()` that calls `loadLatest()` once when memory is empty. Validate `offset >= 0`, `limit` from 1 to 100, and filter values. Search lowercase title and `plainText`; return excerpts limited to 140 characters. Detail returns `plainText`, attachment filename/MIME/SHA and warnings but no `html`, `contentHash`, or local paths. Attachment lookup must belong to the selected note before calling store.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npx vitest run tests/unit/migration-runtime.test.ts --reporter=verbose`

Expected: runtime tests pass.

```bash
git add src/shared/ipc.ts src/main/runtime/migration-runtime.ts tests/unit/migration-runtime.test.ts
git commit -m "feat: query persisted Xiaomi exports"
```

### Task 3: IPC, preload, and production storage root

**Files:**
- Create: `src/main/storage/export-root.ts`
- Create: `tests/unit/export-root.test.ts`
- Modify: `src/main/runtime/ipc-handlers.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/unit/ipc-handlers.test.ts`

- [ ] **Step 1: Write failing IPC and path tests**

Assert `exportRoot(userData)` returns `join(userData, 'exports')`. Assert all four preview channels register and forward query/sourceId/SHA arguments to runtime.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/unit/export-root.test.ts tests/unit/ipc-handlers.test.ts --reporter=verbose`

Expected: FAIL because paths and channels do not exist.

- [ ] **Step 3: Wire IPC and preload**

Add channels `getLatestExportSummary`, `getExportPreview`, `getExportPreviewDetail`, and `getExportAttachment`. Expose corresponding `ipcRenderer.invoke` methods. Extend the runtime command pick and handlers without logging request values.

- [ ] **Step 4: Wire application storage**

Instantiate `FileExportBundleStore(exportRoot(app.getPath('userData')))` and pass it as `exports` to `MigrationRuntime`.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npx vitest run tests/unit/export-root.test.ts tests/unit/ipc-handlers.test.ts --reporter=verbose && npm run typecheck`

Expected: tests and TypeScript pass.

```bash
git add src/main/storage/export-root.ts tests/unit/export-root.test.ts src/main/runtime/ipc-handlers.ts src/main/preload.ts src/main/index.ts tests/unit/ipc-handlers.test.ts
git commit -m "feat: expose local export preview IPC"
```

### Task 4: Searchable preview dialog

**Files:**
- Create: `src/renderer/ExportPreviewDialog.tsx`
- Create: `tests/unit/export-preview-dialog.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `tests/unit/migration-wizard.test.tsx`

- [ ] **Step 1: Write failing dialog tests**

Render `App` with an API that returns a latest summary and preview page. Assert the summary restores on mount, “查看导出内容” opens a dialog, typing a search invokes `getExportPreview` with the query, filters update the request, clicking a row loads detail, plain text is visible, and an HTML string such as `<img src=x onerror=...>` does not create an image element.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/unit/export-preview-dialog.test.tsx tests/unit/migration-wizard.test.tsx --reporter=verbose`

Expected: FAIL because the API and dialog do not exist.

- [ ] **Step 3: Implement the dialog**

Use Lucide `Eye`, `Search`, `X`, `ChevronLeft`, `ChevronRight`, `AlertTriangle`, `Paperclip`, and `Image` icons. Use an accessible `role="dialog"`, labeled search input, segmented filter buttons, stable two-column grid, 50-item pages, and Escape handling. Render body inside a `pre`-style plain-text container; render attachment data as `data:<mime>;base64,<data>` only after the user selects a note.

- [ ] **Step 4: Integrate App and latest summary**

Load login states and latest export summary on mount. Add “查看导出内容” next to the metrics when summary exists. Keep confirmation and import behavior unchanged.

- [ ] **Step 5: Style responsive stable layouts**

Add a full-viewport modal overlay, max-width 1120px dialog, 360px list column, scrollable list/detail regions, 36px icon buttons, compact segmented filters, and a single-column layout below 760px. Keep border radius at 8px or less and avoid nested cards.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npx vitest run tests/unit/export-preview-dialog.test.tsx tests/unit/migration-wizard.test.tsx --reporter=verbose`

Expected: UI tests pass.

```bash
git add src/renderer/ExportPreviewDialog.tsx tests/unit/export-preview-dialog.test.tsx src/renderer/App.tsx src/renderer/styles.css tests/unit/migration-wizard.test.tsx
git commit -m "feat: preview exported Xiaomi notes"
```

### Task 5: Full and real-data verification

**Files:**
- No source files expected

- [ ] **Step 1: Run complete verification**

```bash
npm test
npm run typecheck
node scripts/validate-contracts.mjs
npm run build
```

Expected: zero failures, two valid provider contracts, and a successful Electron build.

- [ ] **Step 2: Run the desktop application**

Run: `npm run dev`

Expected: the latest local batch appears after startup; clicking “查看导出内容” opens a searchable dialog without reconnecting Xiaomi.

- [ ] **Step 3: Verify real export storage**

Export the signed-in Xiaomi account and verify the latest batch contains 318 notes, 19 attachment references, copied attachment files, and a usable preview. Restart Electron and verify the same batch restores from disk.
