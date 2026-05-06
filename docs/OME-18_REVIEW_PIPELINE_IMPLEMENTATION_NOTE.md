# OME-18: Upload-to-Review Pipeline & Reviewer Work Queue

Implements OME-3G acceptance criteria on top of the OME-15 documents subsystem,
the OME-14 audit framework, and the OME-10 tenancy spine.

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
  appends a comment-only review). All decisions require `comment`.
- **Reviewer work queue** — `GET /api/v1/review-queue` (admin /
  compliance_lead / expert), filterable by `?status=` and `?farmSiteId=` and
  `?controlPointRef=`. Items ordered by farm site name, then `controlPointRef`
  (acts as section sort key until OME-16 lands a real section model), then
  oldest `submittedAt` first so backlog drains FIFO. Response embeds counts
  per `EvidenceReviewStatus` for header badges.
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
- Mobile UI / camera capture is consumer-side; this is the API surface.
- Corrective-action workflow (closing the loop on `needs_rework`) is OME-83
  (PM spec) and will compose with `evidence.reviewStatus = needs_rework`.
- Reviewer notification fanout (email/push) is deferred to deployment slice
  OME-19.
