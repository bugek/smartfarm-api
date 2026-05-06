# OME-18: Upload-to-Review Pipeline & Reviewer Work Queue

Implements OME-3G acceptance criteria on top of the OME-15 documents subsystem,
the OME-14 audit framework, and the OME-10 tenancy spine.

This note now carries the OME-115 Phase 1 workflow semantics forward. The
current evidence pipeline is a useful base, but it is not the full end-state
contract for live readiness or record-version review.

## OME-115 alignment summary

What already aligns:

- evidence review rows are append-only,
- review comments stay attached to the reviewed work,
- original submitted proof is preserved for audit history.

What remains explicit delta for OME-18 follow-up:

- the shared live readiness surface is exactly `ready | partial | not_ready`,
  not the lower-level evidence statuses used internally today,
- review outcomes must resolve against a specific `GapRecordVersion`, not just
  the evidence row, once OME-16 lands versioned farmer records,
- `unreviewed` stays implicit when the current record version has no review yet,
  rather than becoming a stored state,
- the latest current record version controls live readiness; superseded record
  versions and their reviews remain history only,
- record-level evidence satisfies proof; cycle-level evidence is contextual and
  must not satisfy the record proof contract on its own,
- reviewer outcomes must distinguish `needs_more_evidence` (keeps readiness
  `partial`) from `blocking` (forces `not_ready`),
- experts do not author farmer records in Phase 1; resolution is farmer
  evidence attachment or a superseding farmer-authored record version, followed
  by re-review.

## Scope landed

- **Worker submit path** — `POST /api/v1/evidence` accepts a `documentId`
  produced by the OME-15 document pipeline (preferred path) or, as a fallback,
  a legacy direct-blob trio (`kind`, `storageKey`, `fileName`). Worker provides
  the bound GAP record, optional `controlPointRef`, free-text note, capture
  timestamp, and optional geolocation. Documents must be in status `ready`
  before they can back evidence.
- **Append-only review log** — new `EvidenceReview` table with a Postgres
  `BEFORE UPDATE` trigger (`evidence_review_block_updates`) that raises if
  application code attempts to mutate review rows in place. Cascade-deletes
  through parent Evidence/Organization remain possible so tenant teardown still
  works; explicit application-level deletes are not exposed.
- **Expert review endpoint** — `POST /api/v1/evidence/:id/reviews` (admin /
  compliance_lead / expert) creates a review row and atomically updates the
  parent Evidence row's denormalized `reviewStatus`, `lastReviewedAt`, and
  `lastReviewedByUserId`. Decisions: `verified` (sets status `verified`),
  `needs_rework` (sets status `needs_rework`), `comment` (status unchanged,
  appends a comment-only review). All decisions require `comment`. This remains
  the evidence-level decision surface; once OME-16 introduces
  `GapRecordVersion`, record-level review/write flows must also bind to the
  reviewed version so superseding farmer submissions can reset live review
  posture without mutating history.
- **Reviewer work queue** — `GET /api/v1/review-queue` (admin /
  compliance_lead / expert), filterable by `?status=` and `?farmSiteId=` and
  `?controlPointRef=`. Items ordered by farm site name, then `controlPointRef`
  (acts as section sort key until OME-16 lands a real section model), then
  oldest `submittedAt` first so backlog drains FIFO. Response embeds counts
  per `EvidenceReviewStatus` for header badges. Queue responses should
  eventually surface the record-level readiness rollup
  (`ready | partial | not_ready`) alongside evidence-level status so expert UI
  does not treat evidence review state as the shared readiness contract.
- **Source-evidence preservation** — once submitted, evidence row holds an
  immutable reference to the original document blob (via `storageKey` /
  `documentId`). Review decisions only update derived `reviewStatus`; the
  blob and the review history are not lost on retry/rework.
- **Audit emissions** — `evidence.submitted`, `evidence.review_verified`,
  `evidence.review_needs_rework`, `evidence.review_comment`, all carrying
  membership/role, GAP record, control point, and prev/next status payloads.

## Schema additions (`prisma/schema.prisma`)

- Enum `EvidenceReviewStatus`: `pending_review | verified | needs_rework`.
- Enum `EvidenceReviewDecision`: `verified | needs_rework | comment`.
- `Evidence` extended with `organizationId` (denormalized for tenant-scoped
  queue queries — backfilled in migration), `controlPointRef`, `noteText`,
  `geoLat`, `geoLng`, `submittedByUserId`, `submittedAt`, `reviewStatus`,
  `lastReviewedAt`, `lastReviewedByUserId`, plus indexes
  `(organizationId, reviewStatus, createdAt)` and
  `(organizationId, controlPointRef, reviewStatus)`.
- New `EvidenceReview` model (id, evidenceId, organizationId, reviewerUserId,
  decision, comment, createdAt; no `updatedAt`).
- `Organization` gains back-relations `evidences` and `evidenceReviews`.

Required follow-up once OME-16 lands:

- add a version-scoped review target (`gapRecordVersionId` or equivalent) to
  the record-level review surface,
- keep `EvidenceReview` as append-only source history for evidence decisions,
  but derive shared readiness from the current record version instead of
  persisting a separate `unreviewed` enum,
- distinguish reviewer semantics that mean "more proof on the same record"
  versus "current record is blocked/not ready".

## Migration

`prisma/migrations/20260506210000_evidence_review_pipeline/migration.sql`:
- creates the new enums,
- alters Evidence with the new columns and indexes,
- backfills `Evidence.organizationId` from the parent `GapRecord` before
  applying `NOT NULL` and the `Organization` FK,
- creates `EvidenceReview` with FKs and indexes,
- installs the `evidence_review_block_updates` trigger.

## How to exercise locally

```
# 1. Apply migrations (fresh DB or after OME-15 migration).
pnpm prisma migrate deploy

# 2. Boot the API and complete the OME-15 upload flow to get a 'ready' document.

# 3. Submit evidence bound to that document.
curl -X POST http://localhost:3000/api/v1/evidence \
  -H "x-organization-id: $ORG" -H "x-user-id: $WORKER" \
  -H "x-membership-role: worker" -H "content-type: application/json" \
  -d '{
    "gapRecordId": "<GAP_ID>",
    "documentId": "<DOC_ID>",
    "controlPointRef": "USDA-HGAP-1.1",
    "noteText": "Cooler pre-cool temp captured at 6:02 AM.",
    "capturedAt": "2026-05-06T06:02:00Z",
    "geoLat": 14.0123, "geoLng": 100.5587
  }'

# 4. List the work queue as an expert.
curl -H "x-organization-id: $ORG" -H "x-user-id: $EXPERT" \
     -H "x-membership-role: expert" \
     "http://localhost:3000/api/v1/review-queue?status=pending_review"

# 5. Decide the evidence.
curl -X POST http://localhost:3000/api/v1/evidence/<EV_ID>/reviews \
  -H "x-organization-id: $ORG" -H "x-user-id: $EXPERT" \
  -H "x-membership-role: expert" -H "content-type: application/json" \
  -d '{ "decision": "verified", "comment": "Reading legible; meets section 1.1." }'
```

## Verification

- `pnpm prisma generate`, `pnpm typecheck`, `pnpm build` all pass.
- Migration not applied to a live DB in this run; operator should run
  `pnpm prisma migrate deploy` after the OME-15 migration before exercising.

## Out of scope / handed off

- A first-class `ControlPoint`/`Section` model is part of OME-16 (Tech Lead).
  This slice intentionally uses a `controlPointRef` string today so OME-16 can
  layer the strongly-typed FK on top without breaking writers.
- Append-only `GapRecordVersion` and record-version review semantics are part of
  OME-16 schema follow-up and the next OME-18 continuation slice; this landed
  pipeline should be treated as evidence-level infrastructure, not the final
  product workflow contract.
- Mobile UI / camera capture is consumer-side; this is the API surface.
- Corrective-action workflow (closing the loop on `needs_rework`) is OME-83.
  Phase 1.1 sequencing and schema stance are captured in
  `docs/OME-83_CORRECTIVE_ACTION_PHASE_1_1_NOTE.md`; it composes with
  `evidence.reviewStatus = needs_rework`.
- Reviewer notification fanout (email/push) is deferred to deployment slice
  OME-19.
