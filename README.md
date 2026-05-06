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

