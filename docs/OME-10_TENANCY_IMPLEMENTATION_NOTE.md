# OME-10 Tenancy Implementation Note

## Core entities

- `Organization`: tenant boundary for all GAP data.
- `User`: global identity record.
- `Membership`: org-scoped join between user and organization with role `admin | compliance_lead | expert | worker`.
- `FarmSite`: physical farm site owned by an organization.
- `Plot`, `CropCycle`, `GapRecord`, and `AuditEvent`: business records that carry or inherit the tenant boundary from `organizationId`.

## What shipped in this slice

- Initial Prisma migration for the multi-tenant GAP spine in `prisma/migrations/20260506123000_init_tenancy_spine/migration.sql`.
- Request-context middleware that resolves membership from `x-organization-id` and `x-user-id`, then exposes the resolved role for downstream handlers.
- Organization listing route filtered by the caller's memberships.
- Membership roster route for the active organization, readable by `admin`, `compliance_lead`, and `expert`.
- Farm-site listing and creation routes scoped to the active organization.
- Plot listing and creation routes scoped to the active organization through owned farm sites.
- Crop-cycle listing and creation routes scoped to the active organization with explicit `organizationId` persistence.
- Audit-event write on farm-site creation so tenant-bound mutations start leaving traceable GAP history.
- Audit-event writes on plot and crop-cycle creation.
- Server-side role enforcement for `admin`, `compliance_lead`, `expert`, and `worker`, with farm-site creation currently limited to `admin` and `compliance_lead`.

## Assumptions

- Single app and single PostgreSQL database remain the deployment model.
- A user can belong to multiple organizations, but each request operates inside one active organization selected by header.
- `expert` can view the active organization's membership roster for advisor coordination; `worker` cannot.
- `expert` can create crop cycles but not farm sites or plots; `worker` remains read-only in this slice.
- Future business modules should reuse the same tenant-context middleware and persist `organizationId` directly on records when they are top-level compliance entities.
- `Plot` inherits tenancy through `FarmSite`; `CropCycle`, `GapRecord`, and `AuditEvent` persist `organizationId` explicitly for safer audit filtering and simpler future AI retrieval.
