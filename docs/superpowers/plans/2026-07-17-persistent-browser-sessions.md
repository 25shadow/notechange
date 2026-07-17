# Persistent Browser Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse isolated Xiaomi and vivo Chromium profiles across application restarts, restoring valid sessions headlessly and showing a login window only when authentication has expired.

**Architecture:** `SessionManager` owns stable per-provider profile directories and mode transitions without deleting browser state. `MigrationRuntime` probes profiles headlessly from both startup status checks and explicit connection requests, then falls back to a visible context only for authentication. Electron injects an application-data-backed profile root.

**Tech Stack:** Electron, TypeScript, Playwright persistent contexts, Vitest

---

### Task 1: Persist isolated provider profiles

**Files:**
- Modify: `tests/unit/session-manager.test.ts`
- Modify: `src/main/browser/session-manager.ts`

- [ ] **Step 1: Write failing tests for stable and isolated directories**

Add tests that open Xiaomi, dispose all contexts, reopen Xiaomi, and assert both launcher calls receive `join(root, 'xiaomi')`. Open vivo and assert it receives `join(root, 'vivo')`. Assert the Xiaomi directory still exists after `disposeAll()`.

```ts
const firstPage = fakePage();
const secondPage = fakePage();
const launcher = sequentialLauncher(fakeContext(firstPage), fakeContext(secondPage));
const manager = new SessionManager({ headless: false }, root, launcher);

await manager.open('xiaomi', xiaomiUrl);
await manager.disposeAll();
await manager.open('xiaomi', xiaomiUrl);

expect(launcher.launchPersistentContext.mock.calls[0][0]).toBe(join(root, 'xiaomi'));
expect(launcher.launchPersistentContext.mock.calls[1][0]).toBe(join(root, 'xiaomi'));
await expect(stat(join(root, 'xiaomi'))).resolves.toBeDefined();
```

- [ ] **Step 2: Run the unit test and verify RED**

Run: `npx vitest run tests/unit/session-manager.test.ts --reporter=verbose`

Expected: FAIL because current calls use different `mkdtemp` directories and `disposeAll()` removes them.

- [ ] **Step 3: Implement stable profile lifecycle and explicit launch mode**

Change `open` to accept a mode and derive the directory without randomness:

```ts
type BrowserMode = 'headed' | 'headless';

async open(provider: string, url: string, mode: BrowserMode = 'headed'): Promise<Page> {
  await this.dispose(provider);
  const safeProvider = provider.replace(/[^a-z0-9_-]/gi, '_');
  const userDataDirectory = join(this.rootDirectory, safeProvider);
  await mkdir(userDataDirectory, { recursive: true });
  return this.launch(provider, url, userDataDirectory, mode);
}
```

Use `{ ...this.launchOptions, headless: mode === 'headless' }` for every launch. Remove `mkdtemp` and all profile-directory deletion from normal disposal and launch failure paths. Ensure a partially launched context is closed on failure.

- [ ] **Step 4: Add headed transition using the existing profile**

Extract a private `switchMode(provider, url, mode)` that reads cookies, closes the old context, launches the new context with the same profile, restores cookies in memory, and navigates. Keep `switchToHeadless` as a wrapper and add:

```ts
switchToHeaded(provider: string, url: string): Promise<Page> {
  return this.switchMode(provider, url, 'headed');
}
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `npx vitest run tests/unit/session-manager.test.ts tests/integration/session-manager.test.ts --reporter=verbose`

Expected: all SessionManager tests pass, including HttpOnly Cookie continuity.

- [ ] **Step 6: Commit**

```bash
git add src/main/browser/session-manager.ts tests/unit/session-manager.test.ts tests/integration/session-manager.test.ts
git commit -m "feat: persist provider browser profiles"
```

### Task 2: Restore sessions headlessly and fall back to login

**Files:**
- Modify: `tests/unit/migration-runtime.test.ts`
- Modify: `src/main/runtime/migration-runtime.ts`

- [ ] **Step 1: Write a failing test for automatic startup restoration**

Create a session manager with no active page. Make `open` return an authenticated page and call `getLoginState('xiaomi')`.

```ts
await expect(runtime.getLoginState('xiaomi')).resolves.toMatchObject({ authenticated: true });
expect(sessionManager.open).toHaveBeenCalledWith('xiaomi', xiaomiUrl, 'headless');
expect(sessionManager.switchToHeaded).not.toHaveBeenCalled();
```

- [ ] **Step 2: Write a failing test for expired-session fallback**

Return unauthenticated for the first headless probe, authenticated from the visible page, and authenticated after the final headless transition.

```ts
await expect(runtime.startLogin('vivo')).resolves.toMatchObject({ authenticated: true });
expect(sessionManager.switchToHeaded).toHaveBeenCalledWith('vivo', vivoUrl);
expect(sessionManager.switchToHeadless).toHaveBeenCalledWith('vivo', vivoUrl);
```

- [ ] **Step 3: Run the runtime tests and verify RED**

Run: `npx vitest run tests/unit/migration-runtime.test.ts --reporter=verbose`

Expected: FAIL because `getLoginState` does not open a stored profile and the session-manager interface has no headed transition.

- [ ] **Step 4: Implement headless probing and visible fallback**

Extend `RuntimeSessionManager` with explicit mode and headed transition:

```ts
open(provider: string, url: string, mode?: 'headed' | 'headless'): Promise<Page>;
switchToHeaded(provider: string, url: string): Promise<Page>;
```

Make `getLoginState` open a missing provider headlessly before checking its provider. In `startLogin`, reuse the active headless page or open one, perform one immediate authentication check, and return immediately when authenticated. Otherwise switch to headed, poll until authenticated, switch back to headless, and verify again.

- [ ] **Step 5: Run runtime and UI tests and verify GREEN**

Run: `npx vitest run tests/unit/migration-runtime.test.ts tests/unit/migration-wizard.test.tsx --reporter=verbose`

Expected: all tests pass; existing UI startup status calls now restore valid profiles without visible windows.

- [ ] **Step 6: Commit**

```bash
git add src/main/runtime/migration-runtime.ts tests/unit/migration-runtime.test.ts
git commit -m "feat: restore cloud sessions headlessly"
```

### Task 3: Store profiles in Electron application data

**Files:**
- Create: `src/main/browser/profile-root.ts`
- Create: `tests/unit/profile-root.test.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write a failing path-construction test**

```ts
expect(browserProfileRoot('/Users/test/Library/Application Support/notechange')).toBe(
  '/Users/test/Library/Application Support/notechange/browser-profiles'
);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run tests/unit/profile-root.test.ts --reporter=verbose`

Expected: FAIL because `browserProfileRoot` does not exist.

- [ ] **Step 3: Implement and wire the profile root**

Create the pure helper:

```ts
import { join } from 'node:path';

export function browserProfileRoot(userDataDirectory: string): string {
  return join(userDataDirectory, 'browser-profiles');
}
```

Instantiate the production session manager with:

```ts
new SessionManager(
  { headless: false },
  browserProfileRoot(app.getPath('userData'))
)
```

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
npm test
npm run typecheck
node scripts/validate-contracts.mjs
npm run build
```

Expected: 0 test failures, TypeScript exits 0, two contracts are valid, and Electron production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/main/browser/profile-root.ts tests/unit/profile-root.test.ts src/main/index.ts
git commit -m "feat: keep sessions in app data"
```

### Task 4: Manual desktop verification

**Files:**
- No source changes expected

- [ ] **Step 1: Start the application**

Run: `npm run dev`

Expected: Electron opens and both account states are probed without opening visible provider browsers.

- [ ] **Step 2: Verify each provider flow**

For both Xiaomi and vivo: connect once, finish login in the visible window, observe the window close, quit and restart Electron, and confirm the account becomes connected without another visible login window.

- [ ] **Step 3: Record any external limitation**

If a provider invalidates its own session, report that the application correctly reopens login; do not weaken provider authentication checks or bypass verification.
