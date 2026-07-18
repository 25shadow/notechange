# Inline Xiaomi Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Xiaomi image placeholders at their original positions in exported-note previews and stop treating legacy `<b>` and `<size>` tags as unsupported content.

**Architecture:** Normalize legacy Xiaomi formatting before sanitization, expose attachment `sourceId` through the read-only preview IPC, and parse `plainText` into ordered text/attachment segments in a focused renderer utility. The preview component renders matched attachments inline and leaves only unreferenced attachments in a trailing section.

**Tech Stack:** TypeScript, Electron IPC, React, DOMPurify/JSDOM, Vitest, Testing Library

---

### Task 1: Normalize legacy Xiaomi formatting

**Files:**
- Modify: `src/main/migration/content.ts`
- Test: `tests/unit/content.test.ts`

- [ ] **Step 1: Write the failing compatibility test**

Add a test proving `<b>` becomes `<strong>`, `<size>` keeps its text, and neither produces a warning:

```ts
it('兼容小米旧版 b 和 size 标签', () => {
  const output = normalizeContent('<p><b>粗体</b><size>大字</size></p>');

  expect(output.html).toBe('<p><strong>粗体</strong>大字</p>');
  expect(output.plainText).toBe('粗体大字');
  expect(output.warnings).toEqual([]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/content.test.ts --maxWorkers=1`

Expected: FAIL because `b` and `size` currently produce `unsupported-content` warnings and are removed without explicit normalization.

- [ ] **Step 3: Implement minimal legacy-tag normalization**

Add a helper before unsupported-tag collection and DOMPurify:

```ts
function normalizeLegacyTags(source: DocumentFragment): string {
  for (const bold of source.querySelectorAll('b')) {
    const strong = source.ownerDocument.createElement('strong');
    strong.replaceChildren(...bold.childNodes);
    bold.replaceWith(strong);
  }
  for (const size of source.querySelectorAll('size')) {
    size.replaceWith(...size.childNodes);
  }
  const container = source.ownerDocument.createElement('div');
  container.append(source.cloneNode(true));
  return container.innerHTML;
}
```

Use the normalized HTML for unsupported-tag discovery, sanitization, plain text, and hashing.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm test -- tests/unit/content.test.ts --maxWorkers=1`

Expected: both content tests pass.

- [ ] **Step 5: Commit the normalization change**

```bash
git add src/main/migration/content.ts tests/unit/content.test.ts
git commit -m "fix: normalize legacy Xiaomi formatting"
```

### Task 2: Expose source IDs and parse inline attachment positions

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/runtime/migration-runtime.ts`
- Create: `src/renderer/inline-attachments.ts`
- Create: `tests/unit/inline-attachments.test.ts`
- Modify: `tests/unit/migration-runtime.test.ts`

- [ ] **Step 1: Write failing parser and runtime tests**

Define the desired parser behavior:

```ts
const attachments = [
  { sourceId: 'file-a', sha256: 'a'.repeat(64), filename: 'a.jpg', mimeType: 'image/jpeg' },
  { sourceId: 'file-b', sha256: 'b'.repeat(64), filename: 'b.png', mimeType: 'image/png' },
  { sourceId: 'voice', sha256: 'c'.repeat(64), filename: 'voice.mp3', mimeType: 'audio/mp3' }
];

expect(splitInlineAttachments('前文\n☺ file-a<0/>\n中间\n☺ file-b\n结尾', attachments)).toEqual({
  segments: [
    { type: 'text', value: '前文\n' },
    { type: 'attachment', attachment: attachments[0] },
    { type: 'text', value: '\n中间\n' },
    { type: 'attachment', attachment: attachments[1] },
    { type: 'text', value: '\n结尾' }
  ],
  unreferenced: [attachments[2]]
});
```

Add a runtime assertion that `getExportPreviewDetail()` returns attachment `sourceId` without returning `localPath`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/unit/inline-attachments.test.ts tests/unit/migration-runtime.test.ts --maxWorkers=1`

Expected: FAIL because the parser does not exist and preview attachments omit `sourceId`.

- [ ] **Step 3: Extend the preview attachment type and runtime mapping**

Change `ExportPreviewDetail.attachments` to:

```ts
attachments: Array<{
  sourceId: string;
  sha256: string;
  filename: string;
  mimeType: string;
}>;
```

Map `{ sourceId, sha256, filename, mimeType }` in `MigrationRuntime.getExportPreviewDetail()`.

- [ ] **Step 4: Implement the pure ordered parser**

Create these exported types and function:

```ts
type PreviewAttachment = ExportPreviewDetail['attachments'][number];
export type InlineSegment =
  | { type: 'text'; value: string }
  | { type: 'attachment'; attachment: PreviewAttachment };

export function splitInlineAttachments(
  plainText: string,
  attachments: PreviewAttachment[]
): { segments: InlineSegment[]; unreferenced: PreviewAttachment[] };
```

Use `/☺\s+([0-9A-Za-z._-]+)(?:<[^\r\n]*\/>)?/g`, match by `sourceId`, consume each attachment at most once, preserve unmatched placeholders as text, and return unreferenced attachments in original order.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test -- tests/unit/inline-attachments.test.ts tests/unit/migration-runtime.test.ts --maxWorkers=1`

Expected: parser and runtime tests pass.

- [ ] **Step 6: Commit the parsing boundary**

```bash
git add src/shared/ipc.ts src/main/runtime/migration-runtime.ts src/renderer/inline-attachments.ts tests/unit/inline-attachments.test.ts tests/unit/migration-runtime.test.ts
git commit -m "feat: map Xiaomi attachment positions"
```

### Task 3: Render ordered inline attachments in the preview

**Files:**
- Modify: `src/renderer/ExportPreviewDialog.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/unit/export-preview-dialog.test.tsx`

- [ ] **Step 1: Write the failing component test**

Return a detail with two image placeholders and one unreferenced audio attachment. Mock `getExportAttachment()` with base64 payloads. Assert the detail DOM order is text, first image, middle text, second image, end text, followed by an “其他附件” section containing the audio filename:

```ts
const detailBody = screen.getByTestId('preview-note-content');
expect([...detailBody.children].map((node) => node.getAttribute('data-kind'))).toEqual([
  'text', 'attachment', 'text', 'attachment', 'text'
]);
expect(screen.getByText('其他附件')).toBeVisible();
expect(screen.getByText('voice.mp3')).toBeVisible();
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `npm test -- tests/unit/export-preview-dialog.test.tsx --maxWorkers=1`

Expected: FAIL because attachments are currently rendered only after the whole body.

- [ ] **Step 3: Add an ordered body renderer**

Import `splitInlineAttachments()`. For each text segment render a `div` with `data-kind="text"` and `white-space: pre-wrap`; for each attachment segment render `AttachmentPreview` in place with `data-kind="attachment"`. Render `unreferenced` items under “其他附件”.

Update `AttachmentPreview` behavior:

```tsx
if (!attachment.mimeType.startsWith('image/')) {
  return <div className="preview-file-attachment"><Paperclip size={14} />{attachment.filename}</div>;
}
```

Track loading failure with a caught promise and render `附件读取失败：<filename>` without removing surrounding text.

- [ ] **Step 4: Add focused styling**

Add `.preview-note-content`, `.preview-inline-image`, and `.preview-file-attachment`. Reuse the existing image limits (`max-width: 100%`, `max-height: 520px`, `object-fit: contain`) and avoid new cards or layout columns.

- [ ] **Step 5: Run the component test and verify GREEN**

Run: `npm test -- tests/unit/export-preview-dialog.test.tsx --maxWorkers=1`

Expected: preview test passes and the body preserves text/image order.

- [ ] **Step 6: Commit the renderer change**

```bash
git add src/renderer/ExportPreviewDialog.tsx src/renderer/styles.css tests/unit/export-preview-dialog.test.tsx
git commit -m "feat: preview Xiaomi images inline"
```

### Task 4: Full verification and real-batch check

**Files:**
- No additional source files expected

- [ ] **Step 1: Run complete automated verification**

Run each command independently:

```bash
npm test -- --maxWorkers=1
npm run typecheck
node scripts/validate-contracts.mjs
npm run build
git diff --check
```

Expected: 0 failed tests, TypeScript exit 0, `2 provider contracts valid`, successful Electron production build, and no whitespace errors.

- [ ] **Step 2: Restart the desktop app and inspect the real batch**

Run: `npm run dev`

Open batch `2026-07-17T07-25-19-267Z-89130b63-4a7a-406d-8bba-93a416634510`, select the welcome note, and verify its five JPEG images appear between their corresponding paragraphs in the same order as the five `☺ fileId` markers.

- [ ] **Step 3: Verify warnings and fallback attachments**

Confirm the welcome note no longer shows warnings for `size` or `b`. Confirm image placeholders are hidden, non-image files are not rendered as broken images, and unreferenced attachments remain visible under “其他附件”.
