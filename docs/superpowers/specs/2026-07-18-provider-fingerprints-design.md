# Provider Fingerprints Design

## Goal

Give the Xiaomi and vivo login contexts stable, isolated browser fingerprints by
integrating the open-source `fingerprint-injector` package with the existing
Playwright persistent-context session lifecycle.

## Scope

- Keep Playwright as the browser automation API and preserve its existing
  persistent Chromium profiles, cookie snapshots, and headed/headless
  transitions.
- Generate one desktop Chromium fingerprint per provider profile on first use.
- Persist each generated fingerprint inside its corresponding provider profile
  directory and reuse it on every later context launch.
- Inject the fingerprint into the Playwright browser context before navigating
  to the provider URL.
- Remove the fingerprint snapshot when the user logs out of that provider.

No account credentials, cookies, note content, or request-authentication fields
are included in a fingerprint snapshot.

## Architecture

`SessionManager` remains the single owner of provider browser contexts. A new
`FingerprintStore` module owns only the provider-local fingerprint snapshot:

- `loadOrCreate(profileDirectory)` reads a versioned snapshot or creates a new
  desktop Chromium fingerprint through `fingerprint-generator`.
- `save(profileDirectory, fingerprint)` uses the same private temporary-file
  and rename pattern as cookie snapshots.
- `remove(profileDirectory)` deletes the fingerprint snapshot during logout.

The manager launches its persistent context as it does today, loads the saved
fingerprint, and uses `fingerprint-injector` to attach that fingerprint to the
context before cookies are restored and before `page.goto()` runs. This order
ensures provider pages and their first-party requests observe the same
fingerprint from their first document.

Each provider profile directory contains its own fingerprint snapshot. Xiaomi
and vivo never share a snapshot. Switching between headed and headless closes
the current context, retains the snapshot, then applies the same fingerprint to
the replacement context.

## Failure Handling

Fingerprint generation, reading, persistence, and injection are required
operations. If any fails, `SessionManager` closes the newly opened context and
propagates the failure. It must not silently continue with an unmodified
browser context.

Malformed or unsupported snapshot data is treated as absent and replaced with a
new generated fingerprint. A valid stored snapshot remains unchanged.

## Logout

Logout keeps its current behavior of clearing browser cookies and deleting
`notechange-session.json`. It also deletes the provider-local fingerprint
snapshot. The next login for that provider creates a new fingerprint; the other
provider remains unaffected.

## Testing

Unit tests will inject a fingerprint generator/store and injector adapter into
`SessionManager` so they can assert behavior without creating a real browser.
They will cover:

- creating and persisting a fingerprint on the first launch;
- loading and reusing it after a context restart;
- provider isolation;
- attaching the fingerprint before cookie restoration and navigation;
- retaining it through headed/headless transitions;
- deleting it only for the logged-out provider; and
- closing an opened context when injection fails.

The existing browser-session integration test remains responsible for verifying
that profile and HttpOnly-cookie behavior still works with a real Chromium
context.
