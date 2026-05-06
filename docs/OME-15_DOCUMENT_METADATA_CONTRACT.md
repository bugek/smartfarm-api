# OME-15 Document Metadata Contract

Purpose: define the reserved shape for `Document.metadataJson` so upload clients,
review tools, audit packet export, and future extraction features use one
shared vocabulary.

Status: v1 contract for OME-15. Fields are optional unless noted, but clients
should prefer these reserved keys over ad hoc metadata names.

Assumptions:

- `Document` remains the immutable source record for an uploaded blob.
- `metadataJson` stores business-facing descriptors, not large derived machine
  outputs.
- Extraction/OCR results will move to a dedicated derived-artifact model in a
  future slice.

## Design rules

- Keep keys stable and human-meaningful; avoid UI-specific names.
- Prefer flat top-level groups over deeply nested arbitrary JSON.
- Do not store raw OCR text, embeddings, or large tables in `metadataJson`.
- Do not duplicate fields already modeled on `Document` (`fileName`,
  `contentType`, `declaredSize`, `blobSha256`, `storageKey`, status fields).
- Unknown keys are tolerated in v1, but reserved keys below win if there is a
  conflict.

## Reserved shape

```json
{
  "label": "Packhouse thermometer photo",
  "category": "temperature_log",
  "source": {
    "channel": "mobile_upload",
    "deviceCapturedAt": "2026-05-06T06:02:00Z",
    "capturedByUserId": "usr_123"
  },
  "gapContext": {
    "gapRecordId": "grp_123",
    "controlPointRef": "TH-GAP-4.2",
    "farmSiteId": "site_123",
    "cropCycleId": "cc_123"
  },
  "review": {
    "displayName": "Cool room log - 6 May AM",
    "reviewerHint": "Check handwriting and timestamp legibility"
  },
  "externalRef": {
    "sourceSystem": "line_app",
    "sourceId": "msg_123"
  },
  "tags": ["cool-room", "daily-log"]
}
```

## Reserved fields

- `label`: short farmer-facing or support-facing label for the document.
- `category`: stable business category for filtering/export, e.g.
  `temperature_log`, `spray_record`, `input_receipt`, `training_certificate`,
  `water_test`, `field_photo`, `other`.
- `source.channel`: how the file entered the system, e.g. `mobile_upload`,
  `web_upload`, `api_import`, `support_backfill`.
- `source.deviceCapturedAt`: capture time from device or upstream source; use
  ISO-8601 UTC when possible.
- `source.capturedByUserId`: user who captured the source artifact when known.
- `gapContext.gapRecordId`: intended GAP record at upload time when already
  known.
- `gapContext.controlPointRef`: control point code or checklist reference used
  by reviewer queues and future analytics.
- `gapContext.farmSiteId`: optional farm site context when document is uploaded
  before evidence is created.
- `gapContext.cropCycleId`: optional crop cycle context when known.
- `review.displayName`: reviewer/export-friendly title to use instead of the raw
  filename when needed.
- `review.reviewerHint`: concise operator hint, not a permanent review decision.
- `externalRef.sourceSystem`: source integration name for traceability.
- `externalRef.sourceId`: upstream record/message id.
- `tags`: short freeform labels for search/filter support.

## API guidance for `POST /api/v1/documents`

- Clients may omit `metadata` entirely.
- If clients send `metadata`, they should send the reserved keys above when the
  information is known.
- Server-side validation can remain permissive in OME-15, but future tightening
  should validate reserved keys without breaking unknown-key passthrough.

## Export and AI guidance

- Audit packet exports should prefer:
  1. `review.displayName`
  2. `label`
  3. `fileName`
- Review queues and future expert tools should prefer `category` and
  `gapContext.controlPointRef` for grouping/filtering.
- Future extraction should read context from this metadata, but write outputs to
  a separate derived-artifact table rather than mutating these fields.

## Non-goals for this contract

- Not a replacement for typed foreign keys on `Evidence` or future control-point
  models.
- Not the storage location for extraction payloads.
- Not a guarantee that every field is present on every upload path.
