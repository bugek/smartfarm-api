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
- Documents are first-class tenant-scoped records with immutable blob references and a processing lifecycle separate from evidence review.
- Evidence should reference a `document` when the file came through the managed upload pipeline; that preserves stable audit/export identity for GAP records.
- Evidence is attached to GAP records and must support image, video, and document metadata.

## Document subsystem notes

- `document` owns upload metadata, storage provider/key, processing status, hash, failure reason, and future extraction handoff.
- `documentJob` tracks validation/extraction placeholder work with retry/dead-letter visibility.
- `document.metadataJson` is reserved for business-facing descriptors and context; see `docs/OME-15_DOCUMENT_METADATA_CONTRACT.md` for the preferred shape.
