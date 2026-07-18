# Import History and Progress Design

## Goal

Make vivo import operations observable while they run and auditable after they
finish. Users can see per-note progress and recent events, then revisit an
import's summary, complete log, and failed-note list after restarting the app.
The existing local export-batch list remains the sole export history.

## Scope

- Add real-time import progress, current-note status, and structured log events.
- Persist import history only; do not duplicate the existing export-batch
  history.
- Persist failed and manual-review note details with a readable reason.
- Add an import-history list and a detail dialog in the renderer.
- Add a provider-card action that opens the vendor's note center in the
  provider's existing authenticated fingerprint-browser profile.

## Import Progress and Events

`MigrationOrchestrator.importToTarget` receives an optional observer. Before a
note begins it emits `started`; after each outcome it emits a snapshot with the
total count, completed count, created/skipped/failed/manual-review counts, the
current note's safe display title and source ID, and a timestamp.

Each event becomes a structured history log entry. Log text is rendered in the
UI but is not the source of truth for counters. Failed or manual-review notes
also add a durable failure entry containing source ID, display title, outcome,
error code, readable message, and timestamp. Raw note content, cookies, and
provider authentication fields are never stored in history logs.

Renderer progress is delivered through a dedicated IPC event channel. The
preload bridge exposes a subscription function that returns an unsubscribe
callback. The UI subscribes only while mounted, uses the snapshot to render a
stable progress bar and counters, and appends recent log lines without waiting
for the final import response.

## Persistent Import History

`FileImportHistoryStore` stores one versioned JSON document per import under
`app.getPath('userData')/import-history`. Each record contains:

- an opaque task ID, selected export batch ID, source and target provider;
- started and completed timestamps;
- status: `running`, `completed`, `completed-with-issues`, `cancelled`, or
  `failed-to-start`;
- total and outcome counters;
- ordered log entries; and
- failed/manual-review note entries.

The history store writes updates atomically with private file permissions,
mirroring the existing export-store persistence pattern. A `running` record is
created before the import loop, updated after every observer event, and
finalized from the returned migration report. If the app stops unexpectedly,
the retained running record remains visible as an interrupted import rather
than being silently discarded.

History list data is intentionally summary-only. A separate detail query loads
the complete log and failure list for one task. The list is newest first.

## Renderer Experience

Selecting an import target opens an import-progress dialog rather than leaving
the platform picker frozen. It shows a determinate bar (`completed / total`),
current note title, per-outcome counters, and the latest few log lines. The
cancel command stays available while work is running.

After completion, the dialog changes to a result state. An issue state links
to the import-history detail. The detail view has a compact summary, a complete
time-ordered operation log, and a failure table with title, outcome, error
reason, and timestamp. Manual-review notes are shown alongside failures with a
distinct outcome label. The user can close the dialog and revisit it from the
new import-history section at any time.

The existing header's short "recent operations" list remains transient UI
feedback. It is populated from import progress for the active task, while the
history area is the persistent record.

## Open Provider Note Centers

Each authenticated Xiaomi/vivo provider card gains an icon button labelled
"打开笔记中心". The renderer invokes a new provider-validated IPC command.
`MigrationRuntime.openNoteCenter(provider)` opens a provider profile in headed
mode when no page is live, otherwise switches the current profile to headed
mode, and navigates it to the established provider note-center URL. It reuses
the same persistent directory, cookies, and stored fingerprint. It never calls
the operating system's default browser.

If the provider is unauthenticated, the command fails with the existing login
state semantics; the renderer keeps the button disabled until login succeeds.

## Error Handling

- A single note failure continues the import and is recorded structurally.
- An observer/history-write error ends the import as a task failure and is
  persisted as `failed-to-start` or `completed-with-issues` according to when
  it occurs.
- IPC progress events are best effort for renderer delivery; store persistence
  remains authoritative.
- History reads validate the schema and ignore corrupt individual records so
  one corrupt file does not hide other import history.

## Testing

Tests cover orchestrator event ordering and counters; file-store atomic
persistence, reload, sorting, and corrupt-file handling; runtime persistence
and IPC event forwarding; preload/IPC channel registration; renderer progress,
completion, cancellation, and failed-note detail rendering; and opening each
provider's visible note center with the existing session-manager profile.
