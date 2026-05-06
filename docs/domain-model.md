# Domain Model Draft

## Core entities

- `organization`
- `user`
- `membership`
- `farmSite`
- `plot`
- `cropCycle`
- `gapChecklist`
- `gapRecord`
- `traceLot`
- `traceLotLineage`
- `traceDispatch`
- `traceabilityEvent`
- `traceabilityExercise`
- `retentionPolicy`
- `retentionHold`
- `retentionExecution`
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
- Traceability should anchor on first-class lot and dispatch records rather than
  document metadata or free-text notes.
- Documents are first-class tenant-scoped records with immutable blob references and a processing lifecycle separate from evidence review.
- Evidence should reference a `document` when the file came through the managed upload pipeline; that preserves stable audit/export identity for GAP records.
- Evidence is attached to GAP records and must support image, video, and document metadata.

## Traceability and retention notes

- `traceLot` is the operational unit for trace-back and trace-forward.
- `traceLotLineage` records split/merge/repack relationships in a queryable
  relational graph.
- `traceDispatch` is the outbound boundary for shipment, transfer, or recall.
- `traceabilityEvent` is a domain event ledger separate from generic
  `auditEvent`.
- Retention belongs in explicit policy/hold/execution tables; do not hide it in
  scattered nullable timestamps across source-of-truth tables.

## Document subsystem notes

- `document` owns upload metadata, storage provider/key, processing status, hash, failure reason, and future extraction handoff.
- `documentJob` tracks validation/extraction placeholder work with retry/dead-letter visibility.
- `document.metadataJson` is reserved for business-facing descriptors and context; see `docs/OME-15_DOCUMENT_METADATA_CONTRACT.md` for the preferred shape.
