# OME-95: Per-GAP-Item Review Threads with Comments

This slice adds a review-thread API that the SmartFarm web review surface can
consume without replacing the existing append-only evidence review log.

## Landed scope

- `GET /api/v1/gap-records/:id/reviews` returns the review thread for one GAP
  record.
- `GET /api/v1/reviews?gapRecordId=<id>` exposes the same thread via a
  dedicated reviews surface.
- `POST /api/v1/reviews/:id/comments` appends a manual thread comment.
- `PATCH /api/v1/reviews/:id` updates the thread status and can optionally add
  a comment in the same request.

## Data model

- New enum `ReviewThreadStatus`:
  `awaiting_review | changes_requested | approved | rejected`
- New field `GapRecord.reviewThreadStatus` with default `awaiting_review`
- Manual comments continue to use `AdvisoryComment`
- Evidence-review history continues to use `EvidenceReview`

The thread response is synthesized at read time by merging:

- manual `AdvisoryComment` rows
- append-only `EvidenceReview` rows from evidence linked to the GAP record

## Status behavior

- Explicit thread status lives on `GapRecord.reviewThreadStatus`.
- Read responses still honor the evidence pipeline:
  - any `needs_rework` evidence forces `changes_requested`
  - all verified evidence forces `approved`
  - explicit `rejected` is preserved

This keeps the web UI aligned with the evidence review queue while still
allowing an expert/compliance lead to set an overall thread state.

## Audit and role gates

- Comment creation allows any organization member role.
- Status updates require `admin`, `compliance_lead`, or `expert`.
- Audit events:
  - `review_thread.comment_added`
  - `review_thread.status_updated`

## Verification

- `pnpm prisma generate --no-engine`
- `pnpm typecheck`
- `pnpm build`

The migration was added but not applied to a live database in this run.
