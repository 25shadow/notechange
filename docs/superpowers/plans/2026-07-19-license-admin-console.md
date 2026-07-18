# License Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a high-density license-service admin console with artifact upload, guided releases, configuration status, and GitHub-managed server updates.

**Architecture:** Keep the standalone Node HTTP service as the deployment unit. Add focused server helpers for artifact storage and configuration metadata; expose authenticated admin JSON endpoints; replace the inline admin HTML with a structured console shell and hash-routed views.

**Tech Stack:** Node.js HTTP server, native `crypto` streaming hash, `fs/promises`, browser HTML/CSS/JavaScript, Vitest, Electron Vite.

---

### Task 1: Add artifact storage primitives

**Files:**
- Create: `license-server/artifact-store.mjs`
- Create: `tests/unit/artifact-store.test.ts`

- [ ] **Step 1: Write failing tests for safe names and SHA-512 metadata**

```ts
expect(validateArtifactName('../secret')).toBeNull()
expect(validateArtifactName('NoteChange-1.2.0.exe')).toBe('NoteChange-1.2.0.exe')
expect(await storeArtifact(root, Readable.from('hello'), 'app.exe')).toMatchObject({
  path: 'releases/app.exe',
  sha512: expect.any(String),
  size: 5
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/unit/artifact-store.test.ts`

- [ ] **Step 3: Implement streaming storage**

```js
export async function storeArtifact(dataDir, input, originalName) {
  const name = validateArtifactName(originalName)
  if (!name) throw new Error('INVALID_ARTIFACT_NAME')
  // write to a random temporary file, update a SHA-512 hash per chunk, then rename
}
```

Store files in `${dataDir}/releases`, cap requests at 4 GiB, calculate Base64 SHA-512, and return the relative URL path and byte size.

- [ ] **Step 4: Run the unit test and verify it passes**

Run: `npx vitest run tests/unit/artifact-store.test.ts`

- [ ] **Step 5: Commit the artifact helper and test**

```bash
git add license-server/artifact-store.mjs tests/unit/artifact-store.test.ts
git commit -m "Add release artifact storage"
```

### Task 2: Expose configuration and release artifact APIs

**Files:**
- Modify: `license-server/server.mjs`
- Modify: `license-server/key-store.mjs`
- Test: `tests/unit/artifact-store.test.ts`

- [ ] **Step 1: Add a failing HTTP test scenario**

Verify an authenticated upload accepts `x-file-name`, stores the file, returns `{ path, sha512, size }`, then a published release is retrievable from the returned path. Verify `/v1/admin/system-status` returns paths and booleans, not PEM/password/hash values.

- [ ] **Step 2: Implement authenticated endpoints**

```js
if (request.method === 'POST' && url.pathname === '/v1/admin/artifacts') return uploadArtifact(request, response)
if (request.method === 'GET' && url.pathname === '/v1/admin/system-status') return json(response, 200, await systemStatus())
if (request.method === 'GET' && url.pathname.startsWith('/releases/')) return serveArtifact(response, url.pathname)
```

Use `storeArtifact`, resolve release paths only beneath the artifact directory, and return 404 for missing files. Make releases use the uploaded `path` and server-computed `sha512`; reject arbitrary client paths.

- [ ] **Step 3: Run the focused tests**

Run: `npx vitest run tests/unit/artifact-store.test.ts`

- [ ] **Step 4: Commit the API changes**

```bash
git add license-server/server.mjs license-server/key-store.mjs tests/unit/artifact-store.test.ts
git commit -m "Add managed release artifact APIs"
```

### Task 3: Replace the admin page with an operational console

**Files:**
- Create: `license-server/admin-console.mjs`
- Modify: `license-server/server.mjs`

- [ ] **Step 1: Add a console renderer with navigation and status shell**

```js
export function renderAdminConsole() {
  return '<!doctype html>...'
}
```

Include desktop sidebar and responsive horizontal mobile navigation, overview metrics, activation-code table, release wizard, source-update logs, configuration status, and logout.

- [ ] **Step 2: Implement the browser release wizard**

The file selector uploads with `fetch('/v1/admin/artifacts', { method: 'POST', headers: { 'x-file-name': file.name }, body: file })`; fill the returned SHA-512 and path internally, then enable version and release-note confirmation. Keep technical values in a collapsed “文件校验详情” disclosure.

- [ ] **Step 3: Replace the legacy inline console response**

Route `/admin` to `renderAdminConsole()` for authenticated users and retain the existing setup/login pages.

- [ ] **Step 4: Verify browser HTML contains the required views**

Run: `node --check license-server/admin-console.mjs && node --check license-server/server.mjs`

- [ ] **Step 5: Commit the console**

```bash
git add license-server/admin-console.mjs license-server/server.mjs
git commit -m "Redesign license admin console"
```

### Task 4: Verify end-to-end behavior and documentation

**Files:**
- Modify: `docs/license-server.md`
- Modify: `.gitignore`
- Test: `tests/unit/artifact-store.test.ts`

- [ ] **Step 1: Document the in-page release flow and visible system-state paths**

Describe upload, version input, publishing, automatic SHA-512, artifact download URLs, and the fact that the settings screen shows only safe metadata.

- [ ] **Step 2: Ignore brainstorming runtime files**

Add `.superpowers/` to `.gitignore`.

- [ ] **Step 3: Run a temporary-directory HTTP verification**

Start `license-server/server.mjs` with temporary `LICENSE_DATA_DIR`, initialize an admin password, upload a small `.exe`, publish `1.2.0`, request `/latest.yml`, request `/releases/<name>`, and request `/v1/admin/system-status`.

- [ ] **Step 4: Run project verification**

Run: `npm test && npm run typecheck && npm run build && git diff --check`

- [ ] **Step 5: Commit and push**

```bash
git add docs/license-server.md .gitignore
git commit -m "Document managed release publishing"
git push origin main
```
