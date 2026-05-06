# OME-134 Site Risk Assessment v1 Execution Design

Purpose: turn [OME-123](/OME/issues/OME-123) into an execution-ready API slice
for site suitability and surrounding-risk capture in `smartfarm-api`.

Status: execution design for implementation under `OME-123`.

## Scope

This slice covers the Thai GAP / HGAP-style site-risk record that answers:

- is this farm site or plot suitable for production,
- what surrounding or historical risks were identified,
- what mitigations were required,
- what evidence supports the assessment,
- what review history and export context prove the assessment was completed.

It is intentionally limited to structured record capture, evidence linkage,
expert review compatibility, and audit/export visibility. It does not include
GIS drawing tools, OCR extraction, or a scheme-specific workflow engine.

## Assumptions

- `OME-123` is the implementation parent and this design should minimize new
  primitives.
- Thai GAP Phase 1.2 should stay as a workflow/rules overlay on the existing
  SmartFarm compliance engine, not a separate product subsystem.
- A site-risk assessment may exist before a crop cycle starts, so the record
  cannot rely on `cropCycleId` alone for context.
- A farmer/expert needs typed surrounding-risk fields for search and export, so
  a JSON-only payload is not sufficient.

## Recommended shape

Use `GapRecord` as the workflow spine and add a typed site-risk payload model
behind each `GapRecordVersion`.

Why this is the smallest clean approach:

- `GapRecord`, `GapRecordVersion`, evidence review, review threads, corrective
  actions, and audit export already exist.
- site-risk needs the same versioning and reviewer history as other GAP
  records.
- the only missing parts are direct farm-site context on the record and a typed
  version payload for risk findings.

Avoid creating a second top-level review/evidence system for site risk.

## Domain model

### 1. Extend `GapRecord`

Additive columns:

- `farmSiteId String?`
- `plotId String?`
- `controlPointRef String?`

Rules:

- `farmSiteId` is required for site-risk records.
- `plotId` is optional and must belong to the selected farm site.
- `cropCycleId` remains optional. If present, it must match the same farm site
  and plot context.
- `controlPointRef` stores the compliance anchor such as `HGAP.FO.1.1` or
  `HGAP.FO.1.2` so list/search/export do not depend on evidence rows alone.

Suggested indexes:

- `@@index([organizationId, farmSiteId, status])`
- `@@index([organizationId, plotId, status])`
- `@@index([organizationId, controlPointRef, status])`

### 2. Add `SiteRiskAssessmentVersion`

One row per `GapRecordVersion`, holding the typed snapshot header for the
assessment.

Suggested shape:

```prisma
enum SiteRiskDecision {
  suitable
  suitable_with_mitigation
  not_suitable
}

enum SiteRiskLevel {
  low
  medium
  high
  critical
}

model SiteRiskAssessmentVersion {
  id                String           @id @default(cuid())
  organizationId    String
  gapRecordVersionId String          @unique
  decision          SiteRiskDecision
  overallRiskLevel  SiteRiskLevel
  summary           String?
  assessedAt        DateTime?
  nextReviewAt      DateTime?
  triggerLabel      String?
  snapshotJson      Json?
  createdAt         DateTime         @default(now())
}
```

Notes:

- `snapshotJson` is allowed for flexible scheme wording, but decision and risk
  level stay typed for filtering and export.
- `gapRecordVersionId` is unique so the typed payload follows the existing
  append-only version chain exactly.

Suggested index:

- `@@index([organizationId, decision, overallRiskLevel, assessedAt])`

### 3. Add `SiteRiskFinding`

Child rows make surrounding-risk details searchable without over-normalizing.

Suggested shape:

```prisma
enum SiteRiskFindingType {
  prior_land_use
  adjacent_land_use
  flooding_drainage
  water_source
  animal_intrusion
  chemical_contamination
  waste_sewage
  access_security
  other
}

enum SiteRiskLocationType {
  onsite
  adjacent_north
  adjacent_south
  adjacent_east
  adjacent_west
  water_source
  buffer_zone
  other
}

model SiteRiskFinding {
  id                        String              @id @default(cuid())
  organizationId            String
  assessmentVersionId       String
  findingType               SiteRiskFindingType
  locationType              SiteRiskLocationType
  sourceLabel               String?
  description               String
  riskLevel                 SiteRiskLevel
  isSignificant             Boolean             @default(false)
  mitigationText            String?
  monitoringText            String?
  sortOrder                 Int                 @default(0)
  createdAt                 DateTime            @default(now())
}
```

Notes:

- `sourceLabel` covers human-readable labels like `old poultry shed`,
  `north-side canal`, or `neighbor cassava field`.
- `locationType` handles the common directional adjacent-land use case without
  introducing geometry in v1.
- findings stay version-scoped; updates create a new version instead of editing
  rows in place.

Suggested indexes:

- `@@index([organizationId, findingType, riskLevel])`
- `@@index([organizationId, locationType, riskLevel])`
- `@@index([assessmentVersionId, sortOrder])`

## Reuse of existing primitives

Use these directly without replacement:

- `FarmSite` and `Plot` for tenancy-safe location context.
- `CropCycle` only when the assessment is tied to a live cycle; it is not the
  primary key for this slice.
- `GapRecord` and `GapRecordVersion` for status, append-only history, and the
  shared reviewer workflow.
- `Document` for upload lifecycle and immutable blob identity.
- `Evidence` for record-version evidence linkage, review status, and audit
  packet export.
- `GapRecordVersionReview` and the review-thread routes for expert decisions.
- `CorrectiveAction` for later closure flow when a review finds blocking risk.
- `AuditEvent` for append-only activity history.

What should not be added in v1:

- no separate `SiteRiskReview` table,
- no separate file/evidence subsystem,
- no GIS polygon or map annotation model,
- no requirement-level many-to-many evidence targeting per finding.

## API surface

Expose a dedicated authoring surface for this slice, but reuse the shared
evidence and review APIs under the hood.

### `POST /api/v1/site-risk-assessments`

Creates:

- `GapRecord`
- initial `GapRecordVersion`
- `SiteRiskAssessmentVersion`
- `SiteRiskFinding[]`

Suggested request:

```json
{
  "farmSiteId": "site_123",
  "plotId": "plot_123",
  "cropCycleId": null,
  "controlPointRef": "HGAP.FO.1.1",
  "title": "North plot site risk assessment",
  "recordedAt": "2026-05-06T00:00:00Z",
  "decision": "suitable_with_mitigation",
  "overallRiskLevel": "medium",
  "summary": "Prior poultry use cleared after soil remediation evidence.",
  "assessedAt": "2026-05-06T00:00:00Z",
  "nextReviewAt": "2027-05-06T00:00:00Z",
  "triggerLabel": "initial_site_setup",
  "findings": [
    {
      "findingType": "prior_land_use",
      "locationType": "onsite",
      "sourceLabel": "former poultry shed",
      "description": "Historical poultry housing on west edge of plot.",
      "riskLevel": "high",
      "isSignificant": true,
      "mitigationText": "Removed structure, replaced topsoil, fenced off drain edge.",
      "monitoringText": "Verify runoff control before planting.",
      "sortOrder": 1
    },
    {
      "findingType": "adjacent_land_use",
      "locationType": "adjacent_north",
      "sourceLabel": "neighbor canal",
      "description": "Canal runoff reaches north boundary during heavy rain.",
      "riskLevel": "medium",
      "isSignificant": true,
      "mitigationText": "Vegetative buffer plus diversion swale.",
      "sortOrder": 2
    }
  ]
}
```

Behavior:

- validate organization ownership of `farmSiteId`, `plotId`, and `cropCycleId`
  in one transaction,
- derive a default title when omitted,
- set `GapRecord.status = draft`,
- set `GapRecord.reviewThreadStatus = awaiting_review`,
- emit `auditEvent` entries for record creation and typed assessment creation.

### `GET /api/v1/site-risk-assessments`

List view for farmer/expert workflows.

Suggested filters:

- `farmSiteId`
- `plotId`
- `cropCycleId`
- `controlPointRef`
- `decision`
- `status`
- `reviewThreadStatus`

Response should embed:

- record ids and current version ids,
- farm site / plot labels,
- current decision and overall risk level,
- finding counts by type,
- current evidence counts,
- latest review summary.

### `GET /api/v1/site-risk-assessments/:id`

Detail view should return:

- current `GapRecord` summary,
- current `SiteRiskAssessmentVersion`,
- current `SiteRiskFinding[]`,
- version history summary,
- evidence summary keyed to the current `gapRecordVersionId`,
- latest review state.

### `PATCH /api/v1/site-risk-assessments/:id`

Creates a new version; does not mutate prior versions in place.

Recommended rule for v1:

- accept the full replacement payload for typed assessment fields,
- supersede the prior `GapRecordVersion`,
- create a fresh `SiteRiskAssessmentVersion`,
- replace the finding set by inserting a new version-scoped `SiteRiskFinding[]`
  collection,
- reset `GapRecord.reviewThreadStatus` to `awaiting_review`.

Do not implement row-level finding patch semantics in v1.

### `POST /api/v1/site-risk-assessments/:id/submit`

Small workflow endpoint that moves the backing `GapRecord` from `draft` to
`submitted` after required fields are present.

This avoids making clients know the generic `GapRecord` workflow details before
the broader record-authoring API exists.

## Evidence linkage

Do not add a new evidence table.

Use the existing upload flow:

1. `POST /api/v1/documents`
2. upload blob
3. `POST /api/v1/evidence`

Evidence payload guidance:

- `gapRecordId` = site-risk record id
- `gapRecordVersionId` is derived server-side from the current record version
- `controlPointRef` = the site-risk control point
- use document metadata `gapContext.farmSiteId`, `gapContext.controlPointRef`,
  and `gapContext.gapRecordId` when uploading before evidence attachment

Recommended document metadata categories for v1:

- `site_risk_map`
- `prior_land_use_record`
- `adjacent_land_photo`
- `drainage_map`
- `water_source_risk`
- `mitigation_photo`

Optional convenience endpoint:

- `POST /api/v1/site-risk-assessments/:id/evidence`

This is not required for day 1 if the generic evidence route is already usable.

## Review linkage

Reuse the existing review-thread primitives.

Minimum day-1 rule:

- reviewers continue using the `GapRecord` review surface,
- the site-risk detail API should expose `gapRecordId` and `currentVersionId`
  so the web app can call the existing review endpoints,
- list/detail responses should include `reviewThreadStatus` plus the latest
  `GapRecordVersionReview` summary.

This keeps site-risk review behavior consistent with other GAP records and
avoids a second approval model.

## OME-129 day-1 acceptance criteria mapping

### Audit history

Required:

- emit `site_risk_assessment.created`
- emit `site_risk_assessment.versioned`
- emit `site_risk_assessment.submitted`
- continue reusing existing `document.*`, `evidence.*`, and `review.*` events

Each payload should carry:

- `organizationId`
- `gapRecordId`
- `gapRecordVersionId`
- `farmSiteId`
- `plotId`
- `cropCycleId`
- `controlPointRef`
- `decision`
- `overallRiskLevel`

### Searchability

Required searchable fields:

- `farmSiteId`
- `plotId`
- `controlPointRef`
- `decision`
- `overallRiskLevel`
- `findingType`
- `locationType`
- `reviewThreadStatus`
- `recordedAt`

This is why typed `SiteRiskFinding` rows are preferable to a JSON-only array.

### Exportable evidence linkage

Required:

- every attached evidence row must bind to the active `gapRecordVersionId`
- export serializers should resolve farm-site context from `GapRecord`
  directly, not only through `CropCycle`
- packet export should include the typed assessment header plus findings, then
  the existing evidence manifest and review history

### Traceable record context

Required:

- `GapRecord` must carry direct `farmSiteId` / `plotId`
- `controlPointRef` must live on the record, not only on evidence
- document metadata should preserve context even before expert review

## Implementation order inside `OME-123`

Recommended smallest sequence:

1. Schema and migration
   Add `GapRecord.farmSiteId`, `GapRecord.plotId`, `GapRecord.controlPointRef`,
   then add `SiteRiskAssessmentVersion` and `SiteRiskFinding` plus indexes.

2. Shared context helpers
   Add reusable validators that resolve `(organizationId, farmSiteId, plotId,
   cropCycleId)` consistently and enforce plot/cycle-to-site matching.

3. Authoring endpoints
   Implement `POST /api/v1/site-risk-assessments`,
   `GET /api/v1/site-risk-assessments`, `GET /:id`, and `PATCH /:id`.

4. Workflow submit endpoint
   Add `POST /api/v1/site-risk-assessments/:id/submit`.

5. Export/readiness integration
   Update audit-readiness and packet-export serializers so non-cycle GAP records
   with direct farm-site context appear correctly.

6. Review/UI handoff
   Surface `gapRecordId`, `currentVersionId`, evidence counts, and latest review
   summary in the site-risk detail/list responses so `smartfarm-web` can plug
   into the existing review routes.

## Explicit non-goals for v1

- map drawing or polygon storage
- geospatial overlap detection
- automatic hazard scoring from AI/OCR
- per-finding evidence binding
- scheme-specific tables for Thai GAP versus HGAP

## Recommendation summary

The implementation should treat site risk as:

- a normal `GapRecord` with direct farm-site context,
- a typed `SiteRiskAssessmentVersion` payload attached to each
  `GapRecordVersion`,
- version-scoped `SiteRiskFinding` rows for searchable surrounding-risk detail,
- the existing `Document`, `Evidence`, review-thread, and audit subsystems for
  proof and traceability.

That gives `OME-123` a narrow implementation path with no duplicate workflow
engine and no dead-end schema for future AI or export work.
