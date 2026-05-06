# OME-15 Document Storage and Metadata Service

## What shipped

- Prisma `Document` and `DocumentJob` models (plus `DocumentKind`, `DocumentStatus`, `DocumentJobKind`, `DocumentJobStatus` enums) in `prisma/schema.prisma`, migrated by `prisma/migrations/20260506200000_documents_subsystem/migration.sql`.
- Optional `Evidence.documentId` link so existing GAP evidence can later reference an immutable document blob without changing today's evidence flow.
- `src/lib/storage.ts` storage abstraction with a `local_disk` provider, HMAC-signed presigned upload/download tokens, immutable blob writes (refuse overwrite), streaming downloads, and SHA-256 hashing.
- `src/lib/jobs.ts` background job runner with claim-via-`SELECT FOR UPDATE SKIP LOCKED`, exponential backoff, retry-then-dead-letter semantics, and an in-process timer started by `src/server.ts`. Handlers cover `validate_blob` (size + hash check, schedules extract) and `extract_text` (placeholder that marks documents `ready` and writes an audit event).
- `src/routes/v1/documents.ts` exposing the upload-to-review surface:
  - `POST /api/v1/documents` create metadata + return presigned upload target (any tenant role).
  - `PUT /api/v1/documents/_blob/:token` token-authenticated blob PUT (no tenant headers; enforced by HMAC).
  - `POST /api/v1/documents/:id/finalize` flips the document to `processing` and enqueues the validate job.
  - `GET /api/v1/documents` and `GET /api/v1/documents/:id` tenant-scoped listing/detail with embedded job state for reviewers.
  - `GET /api/v1/documents/:id/download-url` mints a presigned GET token; `GET /api/v1/documents/_blob/:token` streams the blob.
  - `POST /api/v1/documents/:id/jobs/:jobId/retry` reviewer/admin retry for failed or dead-lettered jobs.
  - `POST /api/v1/documents/_jobs/run` admin-only synchronous tick for tests and on-demand processing.
- Audit-event writes for `document.created`, `document.finalized`, `document.ready`, `document.job_dead_lettered`, and `document_job.retried`, keeping GAP traceability consistent with the OME-10/OME-14 spine.
- `.env.example` updated with `PUBLIC_BASE_URL`, `DOCUMENT_STORAGE_DIR`, `DOCUMENT_SIGNING_SECRET`, `DOCUMENT_JOB_INTERVAL_MS`, `DOCUMENT_JOB_RUNNER_DISABLED`.

## Design choices and assumptions

- Documents are first-class, tenant-scoped records that can exist before any GAP evidence link, so farmers can upload supporting files and reviewers can audit them even when the evidence relationship is added later.
- Blob storage is immutable: `storageKey = org/{orgId}/documents/{docId}/{uuid}` and the writer refuses overwrite, so presigned upload tokens cannot mutate an existing blob even if reused before expiry.
- Local-disk is the only provider today; the API is shaped (`presignUpload`, `presignDownload`, `writeBlob`, `readBlobStream`, `hashBlob`) so an S3-style implementation can drop in without changing the routes or jobs.
- The job runner is in-process to match the current single-app deployment (`OME-10` note). It uses Postgres row-level locking so we can safely run multiple instances later without code changes; setting `DOCUMENT_JOB_RUNNER_DISABLED=true` lets a dedicated worker take over when that day comes.
- Validation enforces declared size at upload time and the validate-blob job rehashes server-side; size mismatches mark the document `failed` once the job exhausts retries, with the failure reason captured for support visibility.
- Extraction (`extract_text`) is a placeholder that flips status to `ready`. The job table already exists so the AI extraction work in a future issue is purely "swap the handler" rather than a schema change.
- Upload size is capped at 100 MB for the local-disk provider; mobile farmer uploads of photos and PDFs fit well below this and we can revisit when video evidence ships.
- Reviewer retries reset `attemptCount` to 0 to give the operator a clean window; the original failure stays visible via the prior `lastErrorMessage` and audit event.

## Metadata contract

- `POST /api/v1/documents` currently accepts permissive `metadata`, but Tech Lead has reserved a preferred business-facing shape in `docs/OME-15_DOCUMENT_METADATA_CONTRACT.md`.
- Use that contract for farmer/mobile upload context, reviewer hints, export display naming, and upstream references; do not treat `metadataJson` as a sink for OCR text or other large derived outputs.
- Keep canonical blob facts on the typed `Document` columns (`fileName`, `contentType`, `declaredSize`, `blobSha256`, `storageKey`) and use metadata only for descriptors that help GAP workflows.

## How to exercise locally

1. Run the Postgres migration: `pnpm prisma migrate dev`.
2. Start the API: `pnpm dev` (the job runner ticks every 5 seconds by default).
3. `POST /api/v1/documents` with tenant headers + JSON body to receive `{ item, upload }`.
4. `PUT` the file bytes to `upload.url` with the raw body. The document moves to `uploaded`.
5. `POST /api/v1/documents/:id/finalize` to flip it to `processing` and enqueue validation.
6. Either wait for the runner tick or call `POST /api/v1/documents/_jobs/run` (admin) to drive jobs.
7. `GET /api/v1/documents/:id` reflects status transitions, blob hash, and per-job state for reviewers.

## Follow-ups for OME-3G (review pipeline)

- Wire `Evidence.documentId` from the upload-to-review pipeline so GAP records reference immutable documents instead of opaque storage keys.
- Replace the `extract_text` placeholder with the real OCR/extraction handler when that work lands.
- Consider adding an antivirus job kind (`scan_blob`) before the document moves out of `processing` once we choose a scanner.
