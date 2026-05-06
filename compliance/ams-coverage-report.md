# AMS Combined Checklist v6.2 - SmartFarm Coverage Report

**Status:** authoritative (regenerated for ruleset revision `1.2.0` on 2026-05-06).
**Owner:** GAP Compliance Expert (46b63bd4)
**Issues:** OME-27 parent plan, OME-107 Phase 4.1 delivery, OME-108 Phase 4.2 delivery.
**Source of truth:** `compliance/_ams-checklist-v6.2.xlsx` parsed by `scripts/parse_ams_checklist.py`.
**Generated against:** `compliance/usda-hgap-v1.json` revision `1.2.0` (`81` controls, status `published`).

This report records the post-Phase-4.2 full-base-coverage state. The authoritative per-row
inventory is `compliance/_ams-coverage-section-b.{md,json}`.

## Headline numbers

- **126** total AMS base control rows across the Combined Checklist v6.2 General Questions and Field Operations worksheets.
- **126** rows mapped by base ruleset `1.2.0`.
- **0** rows mapped only by the leafy-greens overlay.
- **0** rows remain unmapped.

## Phase 4.2 result

Phase 4.2 closes the remaining base Field Operations gap:

- All **126 of 126** AMS base rows are now represented in base-ruleset `ams_ids[]`.
- The 17 deferred Field Operations rows from the approved `OME-108` scope are now covered in `1.2.0`.
- The uplift added 12 new `HGAP.FO.*` controls, keeping bundling conservative and traceable:
  - `HGAP.FO.6.9` bundles `F-7.3` + `F-7.5`
  - `HGAP.FO.6.13` bundles `F-10.1`-`F-10.4`
  - `HGAP.FO.6.14` bundles `F-11.4` + `F-12.2`
- Conditional-in-practice rows still rely on reviewer-facing not-applicable notes rather than structured `applicability_condition`; that follow-up remains outside this issue.

## Remaining base coverage delta

None. Base ruleset `1.2.0` now covers the full AMS Combined Checklist v6.2
General Questions + Field Operations scope.

Still out of scope:

- optional addenda and non-base checklist modules
- future overlay expansion beyond the published leafy-greens overlay
- long-term disposition of SmartFarm-only compatibility controls with `ams_ids: []`

## Control-authoring notes carried forward

- `HGAP.GQ.1.9` covers `G-5.1`, `G-5.2`, and `G-5.3` with an explicit note telling reviewers to mark the control not applicable only when the approved food safety plan does not require laboratory analysis.
- `HGAP.GQ.3.2` now absorbs `G-10.5` and `G-10.9`; `HGAP.GQ.3.4` and `HGAP.GQ.3.5` cover the rest of the approved G-10 hygiene delta.
- `HGAP.GQ.5.2` and `HGAP.GQ.5.3` carry the AMS G-8 corrective-action and non-conforming-product requirements.
- `HGAP.GQ.11.1`, `HGAP.GQ.12.1`-`12.3`, and `HGAP.GQ.13.1` introduce the Waste Management, Food Defense, and Food Fraud base coverage that was missing in `1.0.0`.

## Regeneration command

```powershell
python scripts/parse_ams_checklist.py
```
