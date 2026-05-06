# OME-131 Traceability and Retention Architecture

Purpose: define the Phase 1.1 backend shape for produce traceability and record
retention in `smartfarm-api`.

Assumptions:

- The baseline is current `main`: organizations, farm sites, plots, crop
  cycles, GAP records, evidence, documents, review threads, and append-only
  audit events already exist or are planned nearby.
- OME-131 is about first-class traceability and retention for GAP operations,
  not full inventory costing, ERP, or warehouse management.
- Every new record remains organization-scoped.
- Source-of-truth compliance records stay append-safe; retention work should
  favor archive/tombstone semantics over destructive deletes.

## Problem

The current model can prove that a GAP record has evidence and audit history,
but it still cannot answer the full operational questions auditors and experts
will ask:

- which harvest/pack lots came from which crop cycle or farm site
- which lots were split, merged, packed, or shipped downstream
- which documents support those traceability transitions
- whether the organization completed a trace-back / trace-forward drill
- which records are under retention, on hold, archived, or eligible for purge

Without first-class traceability and retention resources, those answers end up
buried in free-text notes, ad hoc document metadata, or packet-export logic.

## Tech Lead Call

Use a lot-centric traceability model with append-only event history and
policy-driven retention.

- Keep `TraceLot` / dispatch rows as the queryable operational spine.
- Record every business transition in an append-only `TraceabilityEvent`.
- Keep lineage relational (`split`, `merge`, `repack`) instead of only in JSON.
- Treat retention as a policy/execution subsystem, not a flag sprinkled across
  unrelated tables.
- Do not hard-code one legal retention period into the schema. Store policy
  windows in data so GAP, customer, and country-specific rules can evolve.

## Proposed Data Model

### 1. `TraceLot`

Tenant-scoped lot or batch identity used for trace-back / trace-forward.

Suggested fields:

- `id`
- `organizationId`
- `farmSiteId`
- `cropCycleId`
- `code` - human-facing lot code, unique per organization
- `commodityName`
- `varietyName`
- `packHouseName` nullable
- `harvestedAt`
- `packedAt` nullable
- `status` enum: `open`, `on_hold`, `released`, `shipped`, `recalled`, `closed`
- `createdByUserId`
- `createdAt`
- `updatedAt`

Indexes:

- unique `organizationId + code`
- `organizationId + harvestedAt`
- `organizationId + cropCycleId + status`

Why: a dedicated lot row gives the platform a stable traceability anchor that
is independent from any one GAP record or document.

### 2. `TraceLotLineage`

Relational parent/child edges for split, merge, relabel, or repack operations.

Suggested fields:

- `id`
- `organizationId`
- `parentLotId`
- `childLotId`
- `relationshipType` enum: `split`, `merge`, `repack`, `relabel`
- `notes` nullable
- `createdByUserId`
- `createdAt`

Indexes:

- `organizationId + parentLotId`
- `organizationId + childLotId`
- unique `parentLotId + childLotId + relationshipType`

Why: auditors need deterministic lineage queries. Encoding lot genealogy only in
event payload JSON makes trace-forward queries expensive and fragile.

### 3. `TraceLotGapRecord`

Join table linking a lot to the GAP runtime records that justify release or
document compliance checks.

Suggested fields:

- `id`
- `organizationId`
- `lotId`
- `gapRecordId`
- `linkType` enum: `evidence_source`, `release_gate`, `supporting_record`
- `createdByUserId`
- `createdAt`

Indexes:

- `organizationId + lotId`
- `organizationId + gapRecordId`
- unique `lotId + gapRecordId + linkType`

Why: one lot may rely on multiple GAP records, and one GAP record may support
multiple lots. This link keeps those relationships explicit instead of forcing
them through note text.

### 4. `TraceDispatch`

Outbound traceability unit for shipment, transfer, or customer release.

Suggested fields:

- `id`
- `organizationId`
- `code`
- `destinationName`
- `destinationType` enum: `customer`, `warehouse`, `processor`, `internal`
- `shippedAt`
- `status` enum: `draft`, `dispatched`, `acknowledged`, `recalled`, `cancelled`
- `externalRefJson` nullable
- `createdByUserId`
- `createdAt`
- `updatedAt`

Indexes:

- unique `organizationId + code`
- `organizationId + shippedAt`

### 5. `TraceDispatchLot`

Join table between dispatches and lots.

Suggested fields:

- `id`
- `organizationId`
- `dispatchId`
- `lotId`
- `quantity`
- `unit`
- `createdAt`

Indexes:

- `organizationId + dispatchId`
- `organizationId + lotId`
- unique `dispatchId + lotId`

Why: dispatches are the trace-forward boundary for mock recalls and real
withdrawals.

### 6. `TraceabilityEvent`

Append-only business history across lots, dispatches, and recall exercises.

Suggested fields:

- `id`
- `organizationId`
- `lotId` nullable
- `dispatchId` nullable
- `exerciseId` nullable
- `actorUserId` nullable
- `eventType` enum:
  `lot.created`,
  `lot.linked_gap_record`,
  `lot.split`,
  `lot.merged`,
  `lot.repacked`,
  `lot.held`,
  `lot.released`,
  `dispatch.created`,
  `dispatch.finalized`,
  `dispatch.recalled`,
  `exercise.started`,
  `exercise.completed`,
  `retention.archived`,
  `retention.purged`,
  `retention.skipped_hold`
- `occurredAt`
- `payloadJson`
- `createdAt`

Indexes:

- `organizationId + occurredAt`
- `organizationId + lotId + occurredAt`
- `organizationId + dispatchId + occurredAt`

Why: keep business history append-only and user-readable without overloading the
generic `AuditEvent` table. `AuditEvent` remains the platform-wide audit spine;
`TraceabilityEvent` is the domain event ledger for traceability workflows.

### 7. `TraceabilityExercise`

Mock recall / annual drill record.

Suggested fields:

- `id`
- `organizationId`
- `targetLotId`
- `status` enum: `draft`, `running`, `completed`, `failed`
- `startedAt`
- `completedAt` nullable
- `initiatedByUserId`
- `resultJson` nullable
- `createdAt`
- `updatedAt`

`resultJson` should capture:

- lots found during trace-back
- dispatches found during trace-forward
- elapsed minutes
- gaps or missing links
- reviewer conclusion

Why: GAP programs usually need a documented drill, not just a theoretical lot
graph.

### 8. `RetentionPolicy`

Policy row that declares how long a subject type should be kept.

Suggested fields:

- `id`
- `organizationId` nullable for platform default policies
- `subjectType` enum:
  `gap_record`,
  `evidence`,
  `document`,
  `trace_lot`,
  `trace_dispatch`,
  `traceability_exercise`,
  `audit_packet`,
  `derived_artifact`,
  `job_artifact`
- `retainDays`
- `archiveAfterDays` nullable
- `purgeAfterDays` nullable
- `legalBasis` nullable
- `activeFrom`
- `activeTo` nullable
- `isDefault`
- `createdByUserId`
- `createdAt`

Indexes:

- `organizationId + subjectType + activeFrom`
- `subjectType + isDefault`

Why: policy belongs in data, not code constants.

### 9. `RetentionHold`

Legal, audit, or incident hold that prevents purge/archive.

Suggested fields:

- `id`
- `organizationId`
- `subjectType`
- `subjectId`
- `reason`
- `requestedByUserId`
- `releasedAt` nullable
- `releasedByUserId` nullable
- `releaseReason` nullable
- `createdAt`

Indexes:

- `organizationId + subjectType + subjectId`
- `organizationId + releasedAt`

### 10. `RetentionExecution`

Append-only log of archive/purge decisions performed by a worker job.

Suggested fields:

- `id`
- `organizationId`
- `subjectType`
- `subjectId`
- `policyId`
- `decision` enum: `archived`, `purged`, `skipped_hold`, `skipped_not_due`
- `actorType` enum: `system`, `user`
- `actorUserId` nullable
- `evidenceJson`
- `executedAt`

Why: retention actions must remain auditable after the underlying artifact is
moved or deleted.

## API Surface

### Traceability

Add a new router family under `/api/v1/traceability`.

Suggested endpoints:

- `POST /api/v1/traceability/lots`
- `GET /api/v1/traceability/lots`
- `GET /api/v1/traceability/lots/:id`
- `POST /api/v1/traceability/lots/:id/gap-record-links`
- `POST /api/v1/traceability/lots/:id/lineage`
- `POST /api/v1/traceability/lots/:id/hold`
- `POST /api/v1/traceability/lots/:id/release`
- `GET /api/v1/traceability/lots/:id/lineage`
- `GET /api/v1/traceability/lots/:id/events`
- `POST /api/v1/traceability/dispatches`
- `GET /api/v1/traceability/dispatches/:id`
- `POST /api/v1/traceability/exercises`
- `POST /api/v1/traceability/exercises/:id/complete`
- `GET /api/v1/traceability/exercises/:id/report`

Suggested role boundaries:

- `worker`: create lots, attach supporting GAP records, record harvest/pack
  transitions
- `expert`, `compliance_lead`: finalize dispatches, run exercises, hold/release
  lots
- `admin`: full access, including retention policy/hold administration

Example lot-create request:

```json
{
  "code": "LOT-2026-05-06-A",
  "farmSiteId": "site_123",
  "cropCycleId": "cycle_123",
  "commodityName": "Romaine lettuce",
  "varietyName": "Green Towers",
  "harvestedAt": "2026-05-06T04:30:00Z"
}
```

Example lot-detail response shape:

```json
{
  "item": {
    "id": "lot_123",
    "code": "LOT-2026-05-06-A",
    "status": "released",
    "commodityName": "Romaine lettuce",
    "farmSite": { "id": "site_123", "name": "North Block" },
    "cropCycle": { "id": "cycle_123", "cropName": "Romaine lettuce" },
    "gapRecordLinks": [
      { "gapRecordId": "grp_1", "linkType": "release_gate" }
    ],
    "parents": [],
    "children": [{ "lotId": "lot_124", "relationshipType": "split" }],
    "dispatches": [{ "dispatchId": "dsp_9", "code": "SHIP-2026-05-07-01" }]
  }
}
```

### Retention

Add a dedicated router family under `/api/v1/retention`.

Suggested endpoints:

- `GET /api/v1/retention/policies`
- `POST /api/v1/retention/policies`
- `PATCH /api/v1/retention/policies/:id`
- `POST /api/v1/retention/holds`
- `POST /api/v1/retention/holds/:id/release`
- `GET /api/v1/retention/candidates`
- `POST /api/v1/retention/executions`

Important rule: `POST /api/v1/retention/executions` should usually be
admin-only and should prefer archival/tombstone transitions. Hard purge should
only apply to derived artifacts or records whose policy explicitly allows it and
that are not under hold.

Example policy request:

```json
{
  "subjectType": "audit_packet",
  "retainDays": 365,
  "archiveAfterDays": 30,
  "purgeAfterDays": 365,
  "legalBasis": "customer portal convenience copy only"
}
```

## Audit Trail Rules

- Every traceability write emits both:
  - an `AuditEvent` for the platform-wide audit spine
  - a `TraceabilityEvent` for domain reconstruction and operator timelines
- Retention executions emit `AuditEvent` and `TraceabilityEvent` rows even when
  the target artifact is later purged.
- Hold/release actions must capture actor, reason, and affected subject ids.
- Avoid update-in-place status histories beyond the current snapshot row. The
  history belongs in append-only event tables.

Recommended audit action names:

- `trace_lot.created`
- `trace_lot.linked_gap_record`
- `trace_lot.lineage_added`
- `trace_lot.held`
- `trace_lot.released`
- `trace_dispatch.created`
- `trace_dispatch.finalized`
- `traceability_exercise.started`
- `traceability_exercise.completed`
- `retention_policy.created`
- `retention_hold.created`
- `retention_hold.released`
- `retention_execution.archived`
- `retention_execution.purged`

## Retention Semantics

### Source-of-truth records

Default rule: do not hard-delete these in Phase 1.1.

- `GapRecord`
- `Evidence`
- `Document`
- `TraceLot`
- `TraceDispatch`
- `TraceabilityExercise`
- `AuditEvent`
- `TraceabilityEvent`

Preferred lifecycle:

1. active
2. archived or cold-stored
3. purged only when policy explicitly permits it and no hold exists

### Derived artifacts

These can use more aggressive retention:

- generated audit packet files
- extracted OCR text or AI outputs
- temporary import/export staging blobs
- retry/debug artifacts from jobs

Derived artifacts should never be the only surviving source of a GAP decision.

## Integration With Existing SmartFarm Surfaces

- `TraceLotGapRecord` is the bridge back to the current GAP runtime model.
- `Document.metadataJson.externalRef` remains useful, but must not become the
  primary traceability graph.
- Packet export should read from the new lot/dispatch/exercise tables rather
  than rebuilding traceability from document names.
- Future AI features should read `TraceabilityEvent` and lot lineage as the
  canonical context for recall assistance or anomaly detection.

## Phased Delivery

### Phase A: schema + basic writes

- add Prisma models and migrations
- implement lot CRUD, gap-record linking, dispatch creation, and event writes
- emit `AuditEvent` on every write

### Phase B: lineage + drill workflow

- add split/merge/repack endpoints
- add exercise endpoints and drill report payload
- extend packet-export/readiness surfaces with lot and dispatch summaries

### Phase C: retention engine

- add policy and hold endpoints
- add background worker for archive/purge candidate evaluation
- keep execution logs append-only

## Practical Guidance For Platform Engineer

- Keep all traceability lookups organization-scoped and index-backed.
- Use narrow enums and typed join tables for the core graph; do not start with
  a generic polymorphic link model.
- Make destructive retention actions opt-in and policy-checked.
- Reuse existing tenant-context and audit helpers instead of inventing a second
  authorization path.
- Keep exported traceability reports reproducible from relational state plus
  immutable document hashes.

## Suggested Next Action

Implement OME-131 in this order:

1. Prisma schema for `TraceLot`, `TraceLotLineage`, `TraceLotGapRecord`,
   `TraceDispatch`, `TraceDispatchLot`, and `TraceabilityEvent`
2. `/api/v1/traceability/lots` and `/dispatches` endpoints with audit writes
3. drill/exercise endpoints
4. retention policy/hold/execution tables and worker after the traceability
   graph is live
