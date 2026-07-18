# vivo Attachment Degradation Design

## Goal

Keep Xiaomi-to-vivo note imports useful while vivo's local attachment-upload
contract remains unverified. A note's text and supported formatting must import
successfully even when its attachments cannot be written to vivo.

## Behavior

- Notes with no attachments retain the existing import behavior.
- For a Xiaomi note with attachments, the importer creates the vivo note using
  its title and normalized HTML body, without attempting an unverified vivo
  upload request.
- Each skipped attachment adds a structured manual-review entry to the import
  history. The entry identifies the source note and attachment filename/type,
  and uses the readable reason `vivo 网页端附件上传尚未验证`.
- The import report counts the note as created and the attachment omission as a
  warning/manual-review detail. It must not count the entire note as failed.
- Original attachment files remain in their existing local export batch and are
  available through the export preview.

## Boundaries

This is a temporary compatibility mode, not a silent attachment drop. It does
not make any vivo upload request, generate resource IDs, or claim attachment
migration succeeded. When a network-verified vivo resource-upload contract is
available, the history entries provide the source information needed for a
future attachment-retry workflow.

## Testing

Provider tests assert that a note with attachments calls vivo note creation
without resource upload. Orchestrator/runtime tests assert the note is created,
the import continues, and every omitted attachment is recorded in the import
history with its safe metadata and reason.
