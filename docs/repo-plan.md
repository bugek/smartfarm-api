# Repo Plan

## Purpose

`smartfarm-api` is the backend system of record for the SmartFarm platform.

It owns:

- organization tenancy
- user membership and role enforcement
- farm site, plot, and crop cycle records
- GAP records and evidence metadata
- advisory comments
- audit event emission

## Non-goals for now

- frontend UI
- infrastructure orchestration
- AI training pipelines

Those live in separate repositories.

## Near-term issue mapping

- `OME-10`: tenancy schema and role model
- `OME-11`: append-only audit event framework
- `OME-15`: document storage metadata service

