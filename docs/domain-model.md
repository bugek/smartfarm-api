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
- Evidence is attached to GAP records and must support image, video, and document metadata.

