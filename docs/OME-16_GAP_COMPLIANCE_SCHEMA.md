# OME-16: GAP Compliance Schema Design

This document defines the normalized compliance model that turns a GAP ruleset
such as USDA H-GAP into queryable application behavior without hard-coding the
API around one scheme.

## Assumptions

- SmartFarm Phase 1 keeps one stable `GapRecord` per farm-scoped
  control/checklist item, but farmer-authored record content must become
  append-only through a `GapRecordVersion` layer so review history stays tied
  to the exact version that was reviewed.
- A farm site can move to a newer ruleset version over time, but historical
  GAP records and audit exports must remain pinned to the version that was
  active when the work was performed.
- Evidence review remains append-only and expert-facing review threads continue
  to sit on top of the evidence log rather than replacing it.
- The shared readiness contract from OME-115 is exactly
  `ready | partial | not_ready`. If engineering needs richer internal workflow
  stages, keep them internal and do not expose them as the shared readiness
  enum.
- `unreviewed` is implicit for the current record version when it has no review
  actions yet; it should not become a persisted readiness state.
- Experts can append reviews and comments in Phase 1, but they do not author
  farmer record versions. Resolution must come from farmer evidence attachment
  or a superseding farmer-authored record version, followed by re-review.
- USDA H-GAP is the first populated scheme, but the schema must support future
  schemes without changing the API contract shape.

## Design summary

Use two layers:

1. An immutable ruleset catalog layer for scheme/version/section/control
   definitions.
2. A farm runtime layer for which version is active at a farm site and how each
   control is progressing through evidence, review, and corrective action.

This preserves audit reproducibility while letting future issues add new
schemes, extraction rules, or reviewer automation without reworking the core
evidence tables again.

The main OME-115 adjustment is that schema design must separate:

1. immutable ruleset/version catalog state,
2. stable `GapRecord` identity for one control under one cycle/farm binding,
3. append-only `GapRecordVersion` rows that represent what the farmer most
   recently submitted,
4. append-only review actions tied to a specific record version, and
5. a small derived readiness surface on the current record version.

## Catalog layer

### `ComplianceScheme`

Stable scheme family metadata.

- `id`
- `code` unique stable key such as `usda_h_gap`
- `name`
- `authorityName`
- `status` (`draft | active | retired`)

One scheme has many immutable published versions.

### `ComplianceSchemeVersion`

Immutable published ruleset revision.

- `id`
- `schemeId`
- `versionLabel` such as `2026.1`
- `sourceDocumentId` optional link to the uploaded standard/PDF package
- `sourceSha256` hash of the source package used for audit reproducibility
- `publishedAt`
- `effectiveFrom`
- `effectiveTo` nullable
- `isDefault` boolean for new farm bindings only

No in-place edits after publication. If the standard changes, create a new
version row and new descendant rows.

### `ComplianceSectionVersion`

Version-scoped section hierarchy used for grouping, ordering, and UI headings.

- `id`
- `schemeVersionId`
- `parentSectionId` nullable for nested sections
- `code` such as `1` or `4.2`
- `title`
- `description`
- `sequence`

Sections are immutable within a published scheme version.

### `ComplianceControlPointVersion`

Version-scoped control point definition. This replaces the current free-form
`GapChecklist` concept as the source-of-truth catalog.

- `id`
- `schemeVersionId`
- `sectionId`
- `code` such as `USDA-HGAP-1.1`
- `title`
- `requirementText`
- `guidanceText` nullable
- `sequence`
- `isActive`
- `requiresEvidence` boolean
- `requiresExpertReview` boolean
- `defaultDueDays` nullable
- `allowsCorrectiveAction` boolean

These flags drive workflow defaults, while the detailed evidence contract lives
in the requirement table below.

### `ComplianceEvidenceRequirementVersion`

Version-scoped evidence rule attached to one control point. This avoids packing
all capture logic into booleans and gives OME-20 a stable target for AI-ready
extraction hints later.

- `id`
- `controlPointVersionId`
- `code`
- `label`
- `description`
- `isRequired`
- `minimumCount` default `1`
- `allowedKinds` JSON/string enum set (`image`, `video`, `document`, etc.)
- `requiresGeo` boolean
- `requiresCapturedAt` boolean
- `reviewerMustVerify` boolean
- `sortOrder`

If a control only needs a generic proof artifact, it still gets one requirement
row. That keeps runtime status derivation consistent.

## Farm runtime layer

### `FarmSchemeBinding`

Binds a farm site to the exact ruleset version currently in force.

- `id`
- `organizationId`
- `farmSiteId`
- `schemeId`
- `schemeVersionId`
- `activatedAt`
- `deactivatedAt` nullable
- `activatedByUserId`

Rules:

- At most one active binding per `(farmSiteId, schemeId)`.
- New `GapRecord` rows inherit the active `schemeVersionId` through this
  binding.
- When a farm moves to a new version, old records stay pinned to the previous
  version.

### `GapRecord`

Keep `GapRecord` as the stable control-instance row instead of inventing a new
top-level entity. That minimizes churn because evidence, review threads, and
audit events already key off `gapRecordId`, while still allowing record content
to move to append-only versions.

Additive fields:

- `farmSchemeBindingId`
- `schemeVersionId`
- `sectionVersionId`
- `controlPointVersionId`
- `currentVersionId`
- `currentReadinessStatus`
- `dueAt` nullable
- `startedAt` nullable
- `evidenceSatisfiedAt` nullable
- `verifiedAt` nullable
- `latestCorrectiveActionId` nullable

Compatibility:

- `checklistId` becomes legacy compatibility during migration and should be
  removed after all writers/readers use `controlPointVersionId`.
- Existing `title`/`notes` can remain as farm-entered context, not catalog
  definition.
- Current mutable `status` / `reviewThreadStatus` fields should be treated as
  transitional operational state. The shared product-facing readiness contract
  belongs on `currentReadinessStatus` for the current version, not on those
  legacy enums.

### `GapRecordVersion`

Append-only farmer-authored snapshot for one GAP record. This is the schema
layer that lets Phase 1 preserve reviewed history when a farmer corrects or
resubmits a record.

- `id`
- `gapRecordId`
- `organizationId`
- `versionNumber`
- `isCurrent`
- `supersededAt` nullable
- `supersededByVersionId` nullable
- `createdByUserId`
- `recordedAt` nullable
- `titleSnapshot`
- `notesSnapshot` nullable
- `createdAt`

Rules:

- At most one version is current for a given `gapRecordId`.
- Superseding a farmer record creates a new version row; the previous version is
  marked superseded but retained for history/export.
- The latest current version controls live readiness. Superseded versions and
  their reviews remain visible to exports and reviewers but must not control the
  current farmer-facing readiness view.

### `GapRecordVersionReview`

Append-only review action tied to a specific `GapRecordVersion`. This is
separate from evidence-level review rows because OME-115 requires record-level
review history to survive superseding farmer submissions.

- `id`
- `gapRecordVersionId`
- `organizationId`
- `reviewerUserId`
- `decision` (`approved | needs_more_evidence | blocking | comment`)
- `comment`
- `createdAt`

Rules:

- No in-place updates; corrections are new rows.
- `unreviewed` is implicit when the current `GapRecordVersion` has no review
  rows yet.
- `needs_more_evidence` keeps the record readiness at `partial`.
- `blocking` forces the record readiness to `not_ready`.
- Experts append review actions/comments, but only farmer activity creates a new
  `GapRecordVersion`.

### `CorrectiveAction`

Runtime remediation work item created when a control or a required evidence item
fails review.

- `id`
- `organizationId`
- `gapRecordId`
- `triggeredByEvidenceReviewId` nullable
- `triggeredByCommentId` nullable
- `status` (`open | resolved | cancelled`)
- `reasonCode` nullable
- `instructions`
- `dueAt` nullable
- `resolvedAt` nullable
- `resolvedByUserId` nullable

Links:

- One control can accumulate multiple corrective actions over time.
- `GapRecord.latestCorrectiveActionId` points to the currently open or most
  recent action for fast thread/UI access.
- Replacement evidence rows remain linked through `gapRecordId`; no separate
  corrective-action-to-evidence join is required for v1.

## Derived readiness status

Persist or derive a denormalized `GapRecord.currentReadinessStatus` and always
compute it from the current record version plus authoritative
evidence/review/runtime fields. The shared enum is exactly:

- `ready`
- `partial`
- `not_ready`

Status rules and precedence:

1. `not_ready`
   Set when there is no usable current version for a required control, the
   latest current-version review decision is `blocking`, or required proof for
   the current version is missing in a way product treats as blocking.
2. `partial`
   Set when the current version exists but still awaits proof or review. This
   includes the implicit unreviewed state, pending expert review, and explicit
   `needs_more_evidence`.
3. `ready`
   Set when the current version has the required record-level proof and the
   latest current-version review has no unresolved `blocking` or
   `needs_more_evidence` outcome.

Operational workflow states such as "started", "submitted", or "overdue" may
still exist for internal queueing, but they are not substitutes for the shared
readiness contract.

## Record-level proof vs cycle-level context

OME-115 makes the proof boundary explicit:

- record-level evidence attached to the current GAP record/version satisfies the
  compliance proof requirement,
- cycle-level or farm-level evidence can add context for reviewers and audit
  packets,
- contextual evidence must not satisfy a
  `ComplianceEvidenceRequirementVersion.minimumCount` on its own.

This keeps readiness derivation local, explainable, and reproducible.

## Ruleset versioning and reproducible audit exports

Audit reproducibility comes from immutable version references, not mutable codes
looked up at export time.

Required storage rules:

- `FarmSchemeBinding` stores both `schemeId` and `schemeVersionId`.
- `GapRecord` stores `schemeVersionId`, `sectionVersionId`, and
  `controlPointVersionId` directly, even though they are derivable from the
  binding, so exported evidence remains reproducible after farm version changes.
- `ComplianceSchemeVersion` stores `versionLabel`, publication timestamps, and a
  source package hash (`sourceSha256`).
- Audit packet exporters should embed:
  - scheme code
  - scheme version label
  - scheme version id
  - source document hash
  - control point code/title from the pinned version rows

Result: if USDA H-GAP publishes a new revision later, historical packets still
resolve against the exact frozen version that governed the farm at the time.

## Migration path from current schema

This design intentionally avoids breaking the OME-18/OME-95 surfaces.

1. Introduce the new catalog and farm-binding tables.
2. Add typed foreign keys onto `GapRecord` while keeping `checklistId`.
3. Backfill `GapRecord.controlPointVersionId` from `GapChecklist.code`.
4. Keep `Evidence.controlPointRef` temporarily as a denormalized compatibility
   field populated from `GapRecord.controlPointVersion.code`.
5. Update review-queue sorting/filtering to use section/control sequence while
   still returning `controlPointRef` in responses for clients that expect it.
6. Once all read/write paths use typed IDs, remove `GapChecklist` and the
   stringly-typed write dependency.

## API implications

- `GET /api/v1/gap-records` should expose both the stable typed IDs and the
  human-readable section/control codes, plus the shared
  `currentReadinessStatus`.
- `POST /api/v1/evidence` should eventually stop accepting an arbitrary
  `controlPointRef` from the caller; it should derive the control from the
  bound `gapRecordId`.
- Review-write APIs should target the current `gapRecordVersionId` rather than a
  mutable record row so superseding farmer submissions reset live review
  posture without erasing history.
- `GET /api/v1/review-queue` should sort by section/control sequence rather than
  a string comparison on `controlPointRef`.
- OME-20 can attach extraction suggestions and reviewer override fields to
  `ComplianceEvidenceRequirementVersion` and `ComplianceControlPointVersion`
  without changing runtime evidence ownership.

## Recommended next implementation slices

- Platform Engineer: add the versioned catalog tables plus additive typed FKs on
  `GapRecord`.
- Platform Engineer: migrate review queue and gap-record reads to section/control
  ordering from typed relations.
- GAP Compliance Expert: populate the initial USDA H-GAP version rows and flag
  which controls require evidence and expert review.
