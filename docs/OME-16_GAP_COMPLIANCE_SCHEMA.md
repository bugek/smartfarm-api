# OME-16: GAP Compliance Schema Design

This document defines the normalized compliance model that turns a GAP ruleset
such as USDA H-GAP into queryable application behavior without hard-coding the
API around one scheme.

## Assumptions

- SmartFarm Phase 1 continues to treat one `GapRecord` as the runtime state for
  one farm-scoped control/checklist item.
- A farm site can move to a newer ruleset version over time, but historical
  GAP records and audit exports must remain pinned to the version that was
  active when the work was performed.
- Evidence review remains append-only and expert-facing review threads continue
  to sit on top of the evidence log rather than replacing it.
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

Keep `GapRecord` as the runtime control-instance row instead of inventing a new
top-level entity. That minimizes churn because evidence, review threads, and
audit events already key off `gapRecordId`.

Additive fields:

- `farmSchemeBindingId`
- `schemeVersionId`
- `sectionVersionId`
- `controlPointVersionId`
- `derivedControlStatus`
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

### `ControlReviewState`

Runtime rollup for the control-level review posture. This is separate from the
append-only `EvidenceReview` log.

- `id`
- `gapRecordId`
- `organizationId`
- `status` (`awaiting_review | changes_requested | approved | rejected`)
- `lastReviewerUserId` nullable
- `lastReviewedAt` nullable
- `commentCount`

Implementation note:

- Current `GapRecord.reviewThreadStatus` can serve as the initial storage home.
- If query pressure grows, this can either stay denormalized on `GapRecord` or
  split into a dedicated table without breaking the external contract.

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

## Derived control status

Persist a denormalized `GapRecord.derivedControlStatus` and always compute it
from authoritative evidence/review/runtime fields. Recommended enum:

- `not_started`
- `in_progress`
- `evidence_captured`
- `verified`
- `needs_rework`
- `overdue`

Status rules and precedence:

1. `needs_rework`
   Set when there is an open corrective action, the latest control review state
   is `changes_requested`, or any required evidence item is currently in
   `needs_rework`.
2. `overdue`
   Set when `dueAt < now()` and the control is not yet `verified`.
3. `verified`
   Set when required evidence is satisfied and either:
   - expert review is not required for the control, or
   - the control review state is `approved`, or
   - every required evidence item that needs verification is `verified`.
4. `evidence_captured`
   Set when all required evidence requirements have at least the minimum
   submitted evidence, but verification is still pending.
5. `in_progress`
   Set when the control has been started or has partial evidence, but required
   evidence is not yet satisfied.
6. `not_started`
   Set when no evidence exists, no comments exist, and the control has not been
   explicitly started.

This precedence keeps reviewer-driven remediation visible instead of being
masked by a later due date check.

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
  human-readable section/control codes.
- `POST /api/v1/evidence` should eventually stop accepting an arbitrary
  `controlPointRef` from the caller; it should derive the control from the
  bound `gapRecordId`.
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
