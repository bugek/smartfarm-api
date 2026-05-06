# smartfarm-api

Backend service for the SmartFarm GAP platform.

This repository is the first implementation home for:

- multi-tenant organization and farm access
- GAP activity and evidence records
- advisor comments and future recommendation services
- audit-ready API contracts for SmartFarm Phase 1

## Phase 1 scope

Phase 1 focuses on GAP readiness first:

- organizations and memberships
- farm sites and plots
- crop cycles
- GAP records and supporting evidence
- role-based access for admins, compliance leads, experts, and workers

## Stack

- Node.js
- TypeScript
- Express
- Prisma
- PostgreSQL

## Scripts

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

## Compliance Artifacts

The canonical SmartFarm GAP ruleset and AMS coverage artifacts now live in:

- `compliance/`
- `scripts/parse_ams_checklist.py`

The `compliance/recovered/ome107-baseline-1.0.0/` package preserves the
authoritative 1.0.0 baseline boundary needed for `OME-107` after the live
ruleset was advanced in place to later revisions.

## Planned modules

- `src/modules/auth`
- `src/modules/organizations`
- `src/modules/farm-sites`
- `src/modules/gap-records`
- `src/modules/evidence`
- `src/modules/advisory`
- `src/modules/audit`

## Notes

- This repo is intentionally standalone, not a monorepo.
- The first execution target for Paperclip is OME-10: tenancy and role model.

## Auth session contract

`OME-101` adds the SmartFarm web auth/session contract:

- `POST /api/v1/auth/login` with `{ email, password }`
- `POST /api/v1/auth/refresh` with `{ refreshToken }`
- `GET /api/v1/auth/session` with `Authorization: Bearer <accessToken>`
- `POST /api/v1/auth/logout` with `{ refreshToken }`

Token responses include:

- `accessToken`
- `refreshToken`
- `accessTokenExpiresAt`
- `refreshTokenExpiresAt`
- `session`

The `session` payload includes:

- `user`
- `activeOrganizationId`
- `memberships[]` with `id`, `organizationId`, `organizationName`, and `role`

Tenant-scoped API routes now accept either:

- `Authorization: Bearer <accessToken>` plus `x-organization-id`
- legacy dev headers: `x-user-id`, `x-organization-id`, and optional `x-membership-role`

For local validation, `.env.example` includes a dev bootstrap user:

- email: `demo@smartfarm.local`
- password: `smartfarm-demo`

## Review thread contract

`OME-95` adds per-GAP-record review thread endpoints on top of the existing
evidence review log:

- `GET /api/v1/gap-records/:id/reviews`
- `GET /api/v1/reviews?gapRecordId=<gapRecordId>`
- `POST /api/v1/reviews/:id/comments`
- `PATCH /api/v1/reviews/:id`

The thread resource is keyed by `gapRecordId`, merges manual advisory comments
with append-only `EvidenceReview` entries, and exposes an overall thread status
for the SmartFarm web review surface.
