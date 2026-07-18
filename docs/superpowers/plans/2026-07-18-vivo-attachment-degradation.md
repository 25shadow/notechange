# vivo Attachment Degradation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Xiaomi note text into vivo even when attachments cannot be uploaded, while recording every omitted attachment in persistent import history.

**Architecture:** `VivoProvider` writes the note body without calling any unverified resource API. The orchestrator treats each source attachment as an omission after a successful note creation and emits a manual-review progress event with safe attachment metadata. The existing import-history runtime persists that event and presents it as an issue.

**Tech Stack:** TypeScript, Vitest, existing import progress/history contracts

---

### Task 1: Create vivo Notes Without Unverified Attachment Uploads

**Files:**
- Modify: `src/main/providers/vivo/vivo-provider.ts`
- Modify: `tests/integration/vivo-provider.test.ts`

- [ ] **Step 1: Write a failing provider test**

```ts
it('creates a vivo note when source attachments are present', async () => {
  const note = fixtureNote({ attachments: [fixtureAttachment()] });

  await expect(provider.upsertNote(note, null)).resolves.toMatchObject({ targetId: expect.any(String) });
  expect(executor.calls).toHaveLength(2);
  expect(executor.calls[1].operation.name).toBe('createSync');
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- tests/integration/vivo-provider.test.ts -t "source attachments"`

Expected: FAIL with `VIVO_ATTACHMENTS_UNSUPPORTED`.

- [ ] **Step 3: Remove the unsupported attachment throw**

Delete only the early `note.attachments.length > 0` rejection in `VivoProvider.upsertNote`. Keep the generated `VivoSyncNote` body/title behavior and do not add a resource upload request.

- [ ] **Step 4: Verify provider tests pass**

Run: `npm test -- tests/integration/vivo-provider.test.ts`

Expected: PASS.

### Task 2: Emit Attachment-Omission Events

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/migration/orchestrator.ts`
- Modify: `tests/integration/orchestrator.test.ts`

- [ ] **Step 1: Write a failing orchestrator test**

```ts
it('records every attachment omission after creating a note', async () => {
  const progress: MigrationProgress[] = [];
  await orchestrator.importToTarget(bundleWithOneAttachedNote, (snapshot) => progress.push(snapshot));

  expect(progress.at(-1)).toMatchObject({ created: 1, manualReview: 1 });
  expect(progress.at(-1)?.current).toMatchObject({
    outcome: 'manual-review',
    errorCode: 'VIVO_ATTACHMENT_UPLOAD_UNVERIFIED',
    attachment: { filename: 'fixture.png', mimeType: 'image/png' }
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- tests/integration/orchestrator.test.ts -t "attachment omission"`

Expected: FAIL because progress snapshots have no attachment omission event.

- [ ] **Step 3: Extend progress metadata and emit omissions**

Extend `MigrationProgress.current` and `ImportFailure` with optional safe attachment metadata:

```ts
attachment?: { filename: string; mimeType: string };
```

After a successful target `upsertNote`, increment `created` once. For each `note.attachments` entry, increment `manualReview` and await the observer with `outcome: 'manual-review'`, error code `VIVO_ATTACHMENT_UPLOAD_UNVERIFIED`, safe title/source ID, attachment filename/mime type, and timestamp. Do not save a failed note checkpoint and do not change the created note status.

- [ ] **Step 4: Verify orchestrator tests pass**

Run: `npm test -- tests/integration/orchestrator.test.ts`

Expected: PASS.

### Task 3: Persist and Display Omitted Attachments

**Files:**
- Modify: `src/main/runtime/migration-runtime.ts`
- Modify: `src/main/storage/import-history-store.ts`
- Modify: `src/renderer/ImportHistoryDialog.tsx`
- Modify: `tests/unit/migration-runtime.test.ts`
- Modify: `tests/unit/import-history-store.test.ts`
- Modify: `tests/unit/import-history-dialog.test.tsx`

- [ ] **Step 1: Write failing persistence/UI tests**

```ts
expect(history.appendFailure).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
  outcome: 'manual-review',
  errorCode: 'VIVO_ATTACHMENT_UPLOAD_UNVERIFIED',
  attachment: { filename: 'fixture.png', mimeType: 'image/png' }
}));
```

```tsx
expect(await screen.findByText('附件未迁移：fixture.png')).toBeTruthy();
expect(screen.getByText('vivo 网页端附件上传尚未验证')).toBeTruthy();
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- tests/unit/migration-runtime.test.ts tests/unit/import-history-store.test.ts tests/unit/import-history-dialog.test.tsx`

Expected: FAIL because attachment metadata is not persisted/rendered.

- [ ] **Step 3: Preserve safe metadata through history**

Pass optional attachment metadata through runtime failure mapping and the validated history schema. Render attachment omission rows distinctly in `ImportHistoryDialog`, with the fixed readable reason `vivo 网页端附件上传尚未验证`. Keep original attachment data only in the existing export bundle; history stores filename and MIME type only.

- [ ] **Step 4: Verify persistence and renderer tests pass**

Run: `npm test -- tests/unit/migration-runtime.test.ts tests/unit/import-history-store.test.ts tests/unit/import-history-dialog.test.tsx`

Expected: PASS.

### Task 4: Full Regression and Commit

**Files:**
- Verify: `tests/integration/vivo-provider.test.ts`
- Verify: `tests/integration/orchestrator.test.ts`
- Verify: `tests/unit/migration-runtime.test.ts`
- Verify: `tests/unit/import-history-store.test.ts`
- Verify: `tests/unit/import-history-dialog.test.tsx`

- [ ] **Step 1: Run feature regression tests**

Run: `npm test -- tests/integration/vivo-provider.test.ts tests/integration/orchestrator.test.ts tests/unit/migration-runtime.test.ts tests/unit/import-history-store.test.ts tests/unit/import-history-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run typechecking and full tests**

Run: `npm run typecheck && npm test`

Expected: both commands exit `0`.

- [ ] **Step 3: Commit implementation**

Run: `git add src/main/providers/vivo/vivo-provider.ts src/main/migration/orchestrator.ts src/main/runtime/migration-runtime.ts src/main/storage/import-history-store.ts src/shared/ipc.ts src/renderer/ImportHistoryDialog.tsx tests && git commit -m "feat: record unsupported vivo attachments"`

Expected: commit contains only attachment-degradation implementation and tests.
