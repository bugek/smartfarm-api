# OME-107 Baseline Recovery Package

This folder restores the authoritative **1.0.0 baseline context** needed by
`OME-107` after the shared compliance workspace was advanced in place to later
`1.1.0` and `1.2.0` revisions.

Canonical workspace
- `D:\work\smartfarm-api-ome110`

Live files of record
- `compliance/usda-hgap-v1.json` (current live base ruleset; now `1.2.0`)
- `compliance/usda-hgap-overlay-leafy-greens-v1.json` (published overlay `0.1.0`)
- `compliance/ams-coverage-report.md`
- `compliance/_ams-coverage-section-b.{md,json}`
- `scripts/parse_ams_checklist.py`

Recovered baseline artifacts in this folder
- `baseline-manifest.json` - published 1.0.0 identity, counts, provenance, and exact later-release row boundaries.
- `ams-coverage-report.md` - 1.0.0 baseline coverage summary for OME-107 planning.
- `_ams-coverage-section-b.{md,json}` - full AMS row inventory classified as `mapped_at_1_0_0` vs introduced later in `1.1.0` / `1.2.0`.

Important caveat
- The exact standalone `1.0.0` JSON body is not preserved on disk after the in-place promotion to `1.2.0`.
- This package therefore recovers the authoritative **baseline release boundary** from the issue trail instead of fabricating a synthetic full JSON file.
- For `OME-107`, the critical source of truth is which AMS rows were still unmapped at `1.0.0`; those rows are captured exactly here.

