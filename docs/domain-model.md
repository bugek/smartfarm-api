# Domain Model Draft

## Core entities

- `organization`
- `user`
- `membership`
- `farmSite`
- `plot`
- `cropCycle`
- `complianceScheme`
- `complianceSchemeVersion`
- `complianceSectionVersion`
- `complianceControlPointVersion`
- `complianceEvidenceRequirementVersion`
- `farmSchemeBinding`
- `gapRecord`
- `controlReviewState`
- `correctiveAction`
- `document`
- `documentJob`
- `evidence`
- `advisoryComment`
- `auditEvent`

## Role model

- `admin`
- `compliance_lead`
- `expert`
- `worker`

## Key assumptions

- One organization can own multiple farm sites.
- Users join organizations through memberships.
- Roles are organization-scoped through memberships.
- GAP data belongs to an organization and usually a farm site or crop cycle.
- GAP rules are defined in immutable scheme-version records, while farm runtime
  state points at the exact active version for audit-safe exports.
- `gapRecord` is the farm/runtime control instance, not the catalog definition
  of a control point.
- Documents are first-class tenant-scoped records with immutable blob references and a processing lifecycle separate from evidence review.
- Evidence should reference a `document` when the file came through the managed upload pipeline; that preserves stable audit/export identity for GAP records.
- Evidence is attached to GAP records and must support image, video, and document metadata.

## Compliance schema notes

- `complianceControlPointVersion` replaces the current free-form checklist
  catalog over time and carries evidence/review policy flags.
- `complianceEvidenceRequirementVersion` captures what proof is required for one
  control so future extraction/AI features can target a stable requirement id.
- `farmSchemeBinding` pins each farm site to a specific scheme version; old
  GAP records remain pinned even after the farm adopts a newer ruleset.
- `controlReviewState` and `correctiveAction` are runtime entities layered on
  top of append-only evidence reviews rather than replacements for them.

## Document subsystem notes

- `document` owns upload metadata, storage provider/key, processing status, hash, failure reason, and future extraction handoff.
- `documentJob` tracks validation/extraction placeholder work with retry/dead-letter visibility.
- `document.metadataJson` is reserved for business-facing descriptors and context; see `docs/OME-15_DOCUMENT_METADATA_CONTRACT.md` for the preferred shape.
