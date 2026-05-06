# OME-83: Corrective Action Phase 1.1 Follow-Up

This note records the Phase 1.1 sequencing decision from the board on
2026-05-06: keep first launch focused on working corrective-action behavior,
not spec expansion.

Assumption: the canonical `OME-19b_CORRECTIVE_ACTION_WORKFLOW_SPEC.md`
referenced in the Paperclip issue is not present in this repository today. This
document is the repo-local engineering follow-up so implementation can proceed
without waiting on a broader spec rewrite.

## Recommendation

For first launch, treat corrective action as a derived workflow on top of the
review pipeline that already exists in the API:

- `POST /api/v1/evidence/:id/reviews` can set `Evidence.reviewStatus` to
  `needs_rework`
- `PATCH /api/v1/reviews/:id` can set `GapRecord.reviewThreadStatus` to
  `changes_requested`
- `POST /api/v1/reviews/:id/comments` already captures remediation guidance in
  the per-record thread
- append-only audit events already record review decisions, comments, and thread
  status changes

That is enough to ship a working corrective-action loop without introducing a
new `corrective_action` table yet.

## Phase 1.1 Behavior

Define one open corrective action as:

- a GAP review thread in `changes_requested`, or
- a GAP review thread whose synthesized status resolves to `changes_requested`
  because at least one evidence item is `needs_rework`

Define the launch path as:

1. Expert or compliance lead marks evidence `needs_rework` and leaves a
   concrete remediation comment.
2. The review thread surfaces that record as `changes_requested`.
3. Worker submits replacement evidence on the same GAP record and can reply in
   the same thread.
4. Expert re-reviews the new evidence.
5. The corrective action is considered closed when the thread no longer resolves
   to `changes_requested` and all blocking evidence is verified.

This keeps the farmer workflow simple: rework stays attached to the same GAP
record instead of forcing a second object model before we need it.

## What To Defer

The following items should stay out of the first launch path unless
implementation proves they are required earlier:

- a dedicated `corrective_action` table
- multiple independently tracked corrective actions per GAP record
- explicit assignee, due date, overdue SLA, or escalation fields
- a separate corrective-action-to-evidence join table
- audit packet export formatting beyond what current review/audit history can
  already support
- notification fanout and reminder jobs

## Schema Stance

The current schema is workable for Phase 1.1.

Why:

- organization scoping already exists on `GapRecord`, `Evidence`, and
  `EvidenceReview`
- the review log is append-only and audit-safe
- `ReviewThreadStatus` plus evidence review state already represent "needs fix"
  versus "verified"
- comments already provide the human instruction channel experts and workers
  need to close the loop

Pushback on the earlier v1 spec direction: do not add a first-class
`corrective_action` entity before the product needs one of these capabilities:

- separate listing/reporting independent of review threads
- multiple concurrent actions under one GAP record
- explicit ownership and due-date tracking
- audit/export requirements that cannot be derived from the existing thread and
  review history

If one of those needs appears, add the new model additively and keep
`EvidenceReview` as the source-of-truth audit trail.

## Implementation Trigger To Revisit

Revisit the broader spec only when one of these becomes true:

- dashboard users must see corrective actions separately from review threads
- one GAP record needs more than one open action at the same time
- the business needs overdue calculations tied to an assigned owner
- export/pilot feedback shows derived history is not sufficient for auditors

## Next Action

When implementation work for OME-83 starts, build the smallest usable slice
first:

- derive open corrective actions from review-thread status
- expose them through the dashboard/review surfaces before adding new schema
- only introduce dedicated corrective-action persistence if the derived model
  breaks on real product requirements
