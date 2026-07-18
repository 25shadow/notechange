# Bidirectional Content Compatibility Design

## Goal

Preserve paragraph and blank-line structure when importing existing Xiaomi
exports into vivo, then establish verified contracts needed for safe vivo to
Xiaomi migration and bidirectional attachment transfer.

## Phase 1: Xiaomi to vivo Text Formatting

The current Xiaomi export format may contain plain text with newline characters
instead of structural HTML. vivo treats those bare newlines as whitespace when
it renders the `content` field, collapsing intended paragraphs.

Before a Xiaomi export is written to vivo, content normalization will detect
text-only content and convert each non-empty line into `<p>...</p>`. Empty lines
become empty paragraphs so vertical separation is retained. Text is HTML-escaped
before wrapping. Existing supported structural HTML (`p`, `br`, lists, strong,
em, links, and image nodes) is retained without double conversion. The canonical
plain-text field remains line-oriented for search, previews, and content hashes.

Tests cover a single newline, consecutive blank lines, special characters, and
mixed supported HTML. Existing exported batches therefore become compatible when
they are imported in a future Xiaomi-to-vivo run; already-created vivo notes are
not modified.

## Phase 2: Contract Verification Before Bidirectional Transfer

The application must not synthesize undocumented provider requests. vivo's
read/list payloads and resource-upload path, plus Xiaomi's attachment-upload
path as a target, require browser-network verification with dedicated test
accounts.

For each direction, capture and validate the browser's actual requests and
response shapes:

- vivo list folders and notes, get note content, download resources;
- vivo resource upload and note-resource reference creation;
- Xiaomi folder/note creation with attachment upload and attachment references.

Record only redacted request/response schemas, endpoint metadata, and payload
shapes in provider contracts. Never commit cookies, account IDs, request tokens,
note bodies, or attachment bytes.

## Enablement Rules

New provider capabilities stay disabled until their contract operation has
`network-verified` status and automated tests cover its serialized payload and
error mapping. The UI states which direction or attachment type is unavailable
rather than silently dropping data.

After verification, adapters map canonical attachments into target-provider
resources, wait for successful upload IDs, then create/update the note with its
resource references. An attachment failure records the affected note as failed
or manual-review in import history; it never produces a falsely successful note
without a visible warning.

## Testing

Phase 1 adds unit tests to content normalization and provider/import integration
tests asserting vivo receives structural HTML. Phase 2 adds contract fixtures,
adapter tests for reading/uploading/referencing attachments, and end-to-end
tests with sanitized browser route fixtures for both migration directions.
