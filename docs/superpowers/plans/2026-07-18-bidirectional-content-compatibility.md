# Bidirectional Content Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Xiaomi paragraph structure in vivo imports and establish verified, safe prerequisites for later bidirectional attachment migration.

**Architecture:** Content normalization turns text-only Xiaomi bodies into structural HTML before canonical notes reach `VivoProvider`. Existing valid HTML stays intact. Vivo-to-Xiaomi and attachment capability remain disabled until browser-network contracts are captured and tested with redacted fixtures.

**Tech Stack:** TypeScript, JSDOM, DOMPurify, Playwright browser context, Vitest

---

### Task 1: Preserve Text Paragraphs in Xiaomi-to-vivo Imports

**Files:**
- Modify: `src/main/migration/content.ts`
- Modify: `tests/unit/content.test.ts`
- Modify: `tests/integration/vivo-provider.test.ts`

- [ ] **Step 1: Write failing normalization tests**

```ts
it('turns plain-text lines into vivo paragraphs', () => {
  const output = normalizeContent('第一段\n第二段');
  expect(output.html).toBe('<p>第一段</p><p>第二段</p>');
});

it('retains blank lines as empty paragraphs', () => {
  const output = normalizeContent('第一段\n\n第二段');
  expect(output.html).toBe('<p>第一段</p><p><br></p><p>第二段</p>');
});
```

Add a provider integration assertion that `VivoProvider.upsertNote` receives `<p>`-based `content` for a canonical note originally normalized from plain text.

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- tests/unit/content.test.ts tests/integration/vivo-provider.test.ts`

Expected: FAIL because text-only input is currently returned with bare newlines.

- [ ] **Step 3: Convert text-only bodies before sanitizing**

In `normalizeContent`, detect whether the parsed input has no element nodes. Split only on `\r?\n`; HTML-escape each text line using a DOM text node; emit `<p>escaped line</p>` for non-empty lines and `<p><br></p>` for empty lines. Leave parsed documents containing elements on the existing legacy-tag normalization and DOMPurify path. Preserve `plainText` and `contentHash` generation after conversion.

- [ ] **Step 4: Verify the text-format tests pass**

Run: `npm test -- tests/unit/content.test.ts tests/integration/vivo-provider.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Phase 1**

Run: `git add src/main/migration/content.ts tests/unit/content.test.ts tests/integration/vivo-provider.test.ts && git commit -m "fix: preserve Xiaomi text paragraphs in vivo"`

### Task 2: Capture vivo Read and Resource Contracts

**Files:**
- Modify: `docs/research/contracts/vivo-notes.contract.json`
- Modify: `docs/research/provider-api-contracts.md`
- Create: `tests/fixtures/vivo/list-notes.json`
- Create: `tests/fixtures/vivo/note-content.json`
- Create: `tests/fixtures/vivo/resource-upload.json`
- Modify: `tests/integration/vivo-provider.test.ts`

- [ ] **Step 1: Capture requests with a dedicated vivo test account**

Open the vivo note center through the app's authenticated browser profile. Use a test note with a small non-sensitive image, then observe the browser's first-party requests for list notes, get note content, resource upload, and note resource references. Record method, path, serialized body keys, and response shapes; redact IDs, tokens, note text, and bytes before saving fixtures.

- [ ] **Step 2: Verify contracts are not yet enabled**

Run: `npm test -- tests/integration/vivo-provider.test.ts`

Expected: existing tests pass while list/get/resource capabilities remain rejected as `*_UNVERIFIED`.

- [ ] **Step 3: Add only network-verified operations**

For every captured operation, add its exact request shape and `network-verified` status to the vivo contract. Add sanitized fixtures and tests that route the captured response through `VivoPageExecutor`, parse it in `VivoApi`, and assert no token/body content is written to logs or fixtures.

- [ ] **Step 4: Verify captured contract tests pass**

Run: `npm test -- tests/integration/vivo-provider.test.ts`

Expected: PASS with each new operation covered by a sanitized fixture.

- [ ] **Step 5: Commit only verified vivo contracts**

Run: `git add docs/research/contracts/vivo-notes.contract.json docs/research/provider-api-contracts.md tests/fixtures/vivo tests/integration/vivo-provider.test.ts && git commit -m "test: verify vivo content contracts"`

### Task 3: Capture Xiaomi Attachment-Target Contracts

**Files:**
- Modify: `docs/research/contracts/xiaomi-notes.contract.json`
- Modify: `docs/research/provider-api-contracts.md`
- Create: `tests/fixtures/xiaomi/upload-image.json`
- Modify: `tests/integration/xiaomi-provider.test.ts`

- [ ] **Step 1: Capture an attachment upload with a dedicated Xiaomi test account**

In the app's Xiaomi authenticated profile, create a test note with a small non-sensitive image. Capture upload request, response, and final note-create/update attachment reference. Redact request credentials, account IDs, image bytes, and note body before producing the fixture.

- [ ] **Step 2: Add failing adapter tests from the sanitized fixture**

```ts
it('serializes a verified Xiaomi attachment reference', async () => {
  await provider.upsertNote(noteWithFixtureAttachment, null);
  expect(executor.calls[0]).toMatchObject({ operation: 'uploadImage' });
  expect(executor.calls[1]).toMatchObject({ operation: 'createNote' });
});
```

- [ ] **Step 3: Add only the captured operations and enable adapter support**

Implement upload/reference calls only when all request body fields and response shapes are network-verified. Retain `VIVO_ATTACHMENTS_UNSUPPORTED` and Xiaomi-side attachment rejection for every uncaptured capability.

- [ ] **Step 4: Verify provider tests pass**

Run: `npm test -- tests/integration/xiaomi-provider.test.ts tests/integration/vivo-provider.test.ts`

Expected: PASS, including explicit rejections for capabilities still without a verified contract.

- [ ] **Step 5: Commit only verified attachment capabilities**

Run: `git add src/main/providers docs/research/contracts tests/fixtures/xiaomi tests/integration/xiaomi-provider.test.ts tests/integration/vivo-provider.test.ts && git commit -m "feat: migrate verified note attachments"`

### Task 4: Full Verification

**Files:**
- Verify: `tests/unit/content.test.ts`
- Verify: `tests/integration/vivo-provider.test.ts`
- Verify: `tests/integration/xiaomi-provider.test.ts`

- [ ] **Step 1: Run format and provider regression tests**

Run: `npm test -- tests/unit/content.test.ts tests/integration/vivo-provider.test.ts tests/integration/xiaomi-provider.test.ts`

Expected: PASS.

- [ ] **Step 2: Run all static and test checks**

Run: `npm run typecheck && npm test`

Expected: both commands exit `0`.

- [ ] **Step 3: Check final change quality**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and no uncommitted implementation files.
