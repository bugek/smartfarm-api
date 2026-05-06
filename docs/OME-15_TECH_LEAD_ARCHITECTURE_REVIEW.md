# OME-15 Tech Lead Architecture Review

Context: this review is based on the in-branch OME-15 implementation in
`prisma/schema.prisma`, `src/lib/storage.ts`, `src/lib/jobs.ts`,
`src/routes/v1/documents.ts`, and its composition with
`src/routes/v1/evidence.ts` / `src/routes/v1/review-queue.ts`.

Assumptions:

- We are still on a single-app + single-Postgres deployment.
- Object storage remains local-disk in this slice, with an S3-compatible
  provider added later behind the same abstraction.
- The immediate product goal is farmer upload -> reviewer visibility ->
  immutable GAP evidence linkage, not full extraction intelligence yet.

## Tech Lead call

This is the right shape for v1.

- `Document` is a first-class tenant-scoped record instead of hiding files under
  `Evidence`, which keeps upload lifecycle, reviewability, and future extraction
  concerns decoupled.
- Immutable `storageKey` references are the correct default for GAP evidence,
  because audit packets and reviewer decisions need a stable blob identity.
- `DocumentJob` gives us enough structure for validation/retry/failure
  visibility without introducing queue infrastructure too early.
- The bridge from `Document` -> `Evidence.documentId` is especially important:
  it preserves a clean boundary between document processing and compliance
  interpretation.

## What this implementation already enables well

- Secure upload/download handoff through short-lived signed URLs.
- Tenant-scoped document metadata reads for support and reviewer workflows.
- Explicit processing states (`pending_upload`, `uploaded`, `processing`,
  `ready`, `failed`, `quarantined`) that map cleanly onto operator language.
- Background-job retry/dead-letter behavior visible in API responses instead of
  hidden in logs.
- A future extraction swap where we replace the handler, not the whole storage
  subsystem.

## Architecture notes to preserve as we continue

1. Keep documents as the system of record for blobs.

   Evidence should reference a document whenever the source file came through
   the managed upload flow. Do not let future features drift back toward
   evidence-owned storage keys except for explicitly temporary compatibility
   paths.

2. Treat `Document.status = ready` as "safe for reviewer use", not "AI complete".

   Today `extract_text` is a placeholder. That is fine, but the semantic meaning
   of `ready` should remain: the blob exists, validation passed, and the file is
   usable in GAP workflows. Future OCR/extraction should add richer outputs
   without blocking ordinary evidence review unless product explicitly wants
   that.

3. Keep job records append-oriented.

   Retrying the existing row is acceptable for now, but avoid turning the job
   table into an overwrite-heavy log of "latest state only" once we add more job
   kinds. For supportability, the long-term direction should preserve attempt
   history either in appended attempts or explicit job-event records.

4. Reserve `metadataJson` for business metadata, not processor exhaust.

   Farmer/reviewer-facing document descriptors belong on `Document` or in
   structured metadata. Large OCR payloads, extracted tables, or embeddings
   should live in a separate artifact/extraction table later, not be packed into
   `metadataJson` or `DocumentJob.resultJson` indefinitely.

## Gaps to close in follow-up slices

- **Artifact model for AI/extraction outputs**
  Add a dedicated table when OCR/extraction becomes real, e.g.
  `DocumentArtifact` / `DocumentExtraction`, keyed by `documentId`, artifact
  type, version, status, and payload/blob reference. That keeps the immutable
  source document separate from derived machine outputs.

- **Stronger metadata contract for audit packet export**
  `metadataJson` is flexible, but audit/export flows will soon need a stable set
  of fields such as capture source, document label/category, optional external
  reference, and export display name. We should define a reserved metadata shape
  before multiple clients start writing ad hoc keys.

- **Malware/scanner stage before `ready` for risky file classes**
  The status model already has `quarantined`; that is good. When we add office
  docs/spreadsheets at scale, insert `scan_blob` before the document becomes
  reviewer-downloadable in regulated workflows.

- **Attempt-history visibility**
  Current retry resets the same job row. Acceptable for v1, but support users
  will eventually need to answer "what failed, when, and how many times" without
  losing prior context. Preserve that history before volume grows.

- **Export packet manifest**
  The current schema stores enough to start, but audit packet generation will be
  cleaner if we introduce a manifest layer that snapshots which document version,
  hash, filename, and evidence link were exported at a given time.

## Practical guidance for Platform Engineer

- Keep the storage abstraction minimal; do not add provider-specific branching
  into route handlers.
- Prefer adding new job kinds over widening document-route responsibilities.
- When extraction lands, write derived outputs to new tables/files and keep the
  original blob immutable.
- When evidence is created from a managed upload, always persist `documentId` in
  addition to `storageKey` so traceability survives future storage migrations.

## Suggested next action once the runtime/status blocker is cleared

Close OME-15 after verifying three end-to-end assertions in a migrated local DB:

1. upload -> finalize -> validate/extract placeholder reaches `Document.status = ready`
2. failed job -> reviewer retry -> job reprocesses with visible state transition
3. `POST /api/v1/evidence` with `documentId` creates reviewer-visible evidence
   tied to the immutable document reference
