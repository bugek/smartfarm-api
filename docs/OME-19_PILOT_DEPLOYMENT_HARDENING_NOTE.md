# OME-19 Pilot Deployment Hardening Note

API-side checklist for the GAP pilot slice in `smartfarm-api`.

## Readiness Surface

- `GET /api/v1/health` stays the lightweight liveness probe.
- `GET /api/v1/health/ready` is the readiness probe for deploys and rollouts.
  It executes a DB round-trip (`SELECT 1`) and should be wired into the load
  balancer / container orchestrator before traffic shifts.
- `GET /api/v1/audit-readiness/dashboard` is the one-roundtrip operator view for
  readiness counts, open corrective actions, and recent activity.
- `GET /api/v1/audit-readiness/packet-export` emits the canonical JSON audit
  packet used as the reproducibility anchor for Phase 1.

## Single-Region Deploy Bar

- Run one API region against one PostgreSQL primary; do not introduce read
  replicas until the pilot workload proves the need.
- Enable gzip or equivalent compression at the edge because dashboard and packet
  payloads are evidence-heavy and mobile users will hit them over constrained
  links.
- Gate rollout on `GET /api/v1/health/ready` instead of plain liveness so a pod
  does not receive traffic before Prisma can reach Postgres.
- Keep the Prisma migration step (`pnpm prisma migrate deploy`) in the release
  workflow before the app restart.

## Backup / Restore Drill

- Take a daily encrypted Postgres backup. Minimum command shape:

```bash
pg_dump "$DATABASE_URL" | age -r <ops-public-key> > smartfarm-api-$(date +%F).sql.age
```

- Store the encrypted artifact outside the serving region.
- Run a restore drill at least once before pilot sign-off:

```bash
age -d -i <ops-private-key> smartfarm-api-YYYY-MM-DD.sql.age | psql "$RESTORE_DATABASE_URL"
```

- Validate the drill with:
  - `pnpm prisma migrate status`
  - `GET /api/v1/health/ready`
  - one `GET /api/v1/audit-readiness/dashboard` request against the restored DB

## Mobile-Web Performance Checks

- Keep dashboard and packet consumers on filtered org/farm queries; do not ship
  client-side fan-out for per-section counts.
- Prefer document-backed evidence (`documentId`) so packet manifests can reuse
  immutable blob metadata rather than refetching uploads.
- Watch payload size in staging with a realistic farm:
  - dashboard JSON should stay under the threshold your mobile shell can render
    without jank
  - packet export is intentionally heavier, but compression should be enabled
    and generation should remain deterministic

## Follow-Up Boundary

- This repo now owns the API contract and readiness probe.
- Infra-specific automation (scheduled backup job wiring, secrets rotation,
  object-store lifecycle policy, region failover) belongs in `smartfarm-infra`.
