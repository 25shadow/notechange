# Provider Fingerprints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Xiaomi and vivo persistent browser profile a stable, isolated fingerprint injected before its provider page loads.

**Architecture:** `FingerprintStore` owns versioned provider-local fingerprint snapshots. `SessionManager` loads or generates a snapshot before launching its persistent Playwright context, applies its User-Agent and viewport as creation options, then delegates script/header injection to `fingerprint-injector` before restoring cookies or navigating. Logout clears cookie and fingerprint snapshots.

**Tech Stack:** TypeScript, Playwright, `fingerprint-generator`, `fingerprint-injector`, Vitest

---

### Task 1: Add Persistent Fingerprint Storage

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/main/browser/fingerprint-store.ts`
- Create: `tests/unit/fingerprint-store.test.ts`

- [ ] **Step 1: Write a failing test for creation and reload**

```ts
it('creates a fingerprint once and reloads it from the provider profile', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notechange-fingerprint-test-'));
  directories.push(directory);
  const fingerprint = fixtureFingerprint();
  const generator = { getFingerprint: vi.fn(() => fingerprint) };
  const store = new FingerprintStore(generator);

  await expect(store.loadOrCreate(directory)).resolves.toEqual(fingerprint);
  await expect(store.loadOrCreate(directory)).resolves.toEqual(fingerprint);
  expect(generator.getFingerprint).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- tests/unit/fingerprint-store.test.ts`

Expected: FAIL because `src/main/browser/fingerprint-store.ts` does not exist.

- [ ] **Step 3: Install the dependency and write the store**

Run: `npm install fingerprint-injector`

Create `src/main/browser/fingerprint-store.ts` with this public interface:

```ts
export interface FingerprintGeneratorClient {
  getFingerprint(): BrowserFingerprintWithHeaders;
}

export class FingerprintStore {
  constructor(private readonly generator: FingerprintGeneratorClient = new FingerprintGenerator({
    browsers: [{ name: 'chrome', minVersion: 120 }],
    devices: ['desktop']
  })) {}

  async loadOrCreate(directory: string): Promise<BrowserFingerprintWithHeaders>;
  async remove(directory: string): Promise<void>;
}
```

Persist `BrowserFingerprintWithHeaders` as `{ version: 1, fingerprint }` in `notechange-fingerprint.json`. `loadOrCreate` accepts only a version-1 object with `headers` and `fingerprint`; it regenerates malformed or missing data. Saving creates the directory, writes a `0600` temporary file, then atomically renames it. `remove` deletes only the fingerprint snapshot.

- [ ] **Step 4: Verify the test passes**

Run: `npm test -- tests/unit/fingerprint-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Cover malformed data and removal**

Write malformed JSON to the snapshot and verify that `loadOrCreate()` invokes the generator and overwrites it. Create an unrelated file, call `remove()`, and assert the unrelated file remains. Run the Task 1 test command and confirm it passes.

- [ ] **Step 6: Commit the storage layer**

Run: `git add package.json package-lock.json src/main/browser/fingerprint-store.ts tests/unit/fingerprint-store.test.ts && git commit -m "feat: persist provider fingerprints"`

Expected: commit succeeds with only the dependency, store, and its unit test staged.

### Task 2: Inject Fingerprints Into Persistent Contexts

**Files:**
- Modify: `src/main/browser/session-manager.ts`
- Modify: `tests/unit/session-manager.test.ts`

- [ ] **Step 1: Write a failing injection-order test**

```ts
it('applies the stored fingerprint before restoring cookies and navigating', async () => {
  const context = fakeContext(fakePage());
  const fingerprint = fixtureFingerprint();
  const attachFingerprint = vi.fn(async () => undefined);
  const store = { loadOrCreate: vi.fn(async () => fingerprint), remove: vi.fn(async () => undefined) };
  const manager = new SessionManager(
    { headless: false }, root,
    { launchPersistentContext: vi.fn(async () => context) },
    store,
    { attachFingerprintToPlaywright: attachFingerprint }
  );

  await manager.open('xiaomi', 'https://i.mi.com/note/h5#/');

  expect(attachFingerprint).toHaveBeenCalledWith(context, fingerprint);
  expect(attachFingerprint.mock.invocationCallOrder[0]).toBeLessThan(
    context.addCookies.mock.invocationCallOrder[0]
  );
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- tests/unit/session-manager.test.ts -t "applies the stored fingerprint"`

Expected: FAIL because `SessionManager` does not accept a fingerprint store or injector.

- [ ] **Step 3: Add injectable dependencies and launch settings**

Import `FingerprintInjector`, `FingerprintStore`, and `BrowserFingerprintWithHeaders` in `src/main/browser/session-manager.ts`. Add constructor dependencies after the existing launcher, defaulted to `new FingerprintStore()` and `new FingerprintInjector()`.

Resolve the snapshot before `launchPersistentContext`, set the User-Agent and viewport as context creation options, then inject before cookies and navigation:

```ts
const fingerprint = await this.fingerprints.loadOrCreate(userDataDirectory);
const options: PersistentContextOptions = {
  ...embeddedBrowserOptions,
  headless: mode === 'headless',
  userAgent: fingerprint.fingerprint.navigator.userAgent,
  viewport: {
    width: fingerprint.fingerprint.screen.width,
    height: fingerprint.fingerprint.screen.height
  }
};
context = await this.launcher.launchPersistentContext(userDataDirectory, options);
await this.injector.attachFingerprintToPlaywright(context, fingerprint);
await context.addCookies(cookies ?? (await this.loadCookies(userDataDirectory)));
```

Leave this inside the existing `try/catch`, so an injection error closes the new context and propagates. In either `logout` path, remove the provider fingerprint snapshot after handling cookies.

- [ ] **Step 4: Verify the focused test passes**

Run: `npm test -- tests/unit/session-manager.test.ts -t "applies the stored fingerprint"`

Expected: PASS.

- [ ] **Step 5: Add lifecycle tests**

Assert that launch options include the fixture User-Agent and viewport; Xiaomi and vivo call `loadOrCreate` with separate directories; headed/headless transitions reload and attach the profile snapshot; `logout('xiaomi')` calls `remove(join(root, 'xiaomi'))` but does not remove vivo's snapshot; a rejected injector invocation calls `context.close()`.

- [ ] **Step 6: Run all SessionManager tests**

Run: `npm test -- tests/unit/session-manager.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit session integration**

Run: `git add src/main/browser/session-manager.ts tests/unit/session-manager.test.ts && git commit -m "feat: inject stable provider fingerprints"`

Expected: commit succeeds with the session manager and its unit tests staged.

### Task 3: Run Regression Checks

**Files:**
- Verify: `tests/integration/session-manager.test.ts`
- Verify: `package.json`

- [ ] **Step 1: Run persistent-browser integration tests**

Run: `npm test -- tests/integration/session-manager.test.ts`

Expected: PASS, retaining profile reuse and HttpOnly-cookie restoration.

- [ ] **Step 2: Run typechecking and the full test suite**

Run: `npm run typecheck && npm test`

Expected: both commands exit `0`, without TypeScript errors or failing tests.

- [ ] **Step 3: Inspect the working tree**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and an empty status output.
