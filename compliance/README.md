# SmartFarm Compliance Rulesets

This directory holds the structured, versioned rulesets that drive the
SmartFarm compliance engine. Engineering loads these files at runtime; they are
not hard-coded into application logic.

## v1 file of record

- `usda-hgap-v1.json` - USDA Harmonized GAP, Field Operations and Harvesting,
  v1 ruleset for the SmartFarm pilot. Scope: **General Questions** and
  **Field Operations** only. **Status: `published`, `ruleset_revision: 1.2.0`.**
- `usda-hgap-overlay-leafy-greens-v1.json` - first commodity overlay of record
  (see Commodity overlays below). **Status: `published`, `ruleset_revision: 0.1.0`,
  `applies_to_versions: ["3.1"]`.**

## Commodity overlays

- `usda-hgap-overlay-leafy-greens-v1.json` - leafy greens overlay on top of
  the base USDA H-GAP ruleset, capturing tightened thresholds and additional
  controls drawn from USDA H-GAP leafy-greens guidance, LGMA Accepted Food
  Safety Practices, and FDA Produce Safety Rule subparts E/F.

### Overlay loading semantics

1. Engine loads the base ruleset for the tenant's scheme + version pair.
2. For each commodity the tenant has selected, engine loads the matching
   overlay file (matched by `applies_to_scheme`, `applies_to_versions`, and
   `commodity`).
3. Overlay controls are appended to the effective control set. Controls with
   `supersedes_base_id` REPLACE the named base control in the effective set
   for that tenant; the base control still exists in the file but is hidden
   for that tenant's audit profile.
4. Hard rule: an overlay can only ADD controls or TIGHTEN thresholds. An
   overlay must NEVER relax a base requirement. Reviewers MUST reject
   overlays that violate this rule.
5. Overlay `id` namespace uses the commodity short code (e.g. `HGAP.LG.*` for
   leafy greens). Overlay ids do not collide with base ids.

The CEO has locked USDA H-GAP as the canonical v1 scheme (see PRODUCT_BRIEF.md
section status: `v1 approved (scheme: USDA H-GAP)`).

## Schema shape (per control point)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable dotted identifier, e.g. `HGAP.GQ.1.1`. Never reused; new versions of the same control bump the file version, not the id. |
| `scheme` | string | Always `USDA_HGAP` for this file. |
| `version` | string | Matches the top-level `version`. |
| `section` | string | `General Questions` or `Field Operations`. |
| `subsection` | string | Human-readable subsection name from the source standard. |
| `title` | string | Short imperative summary. |
| `description` | string | Operational paraphrase of what is required. |
| `evidence_required` | bool | If true, at least one evidence artifact must be linked before the control can be marked met. |
| `expert_review_required` | bool | If true, a GAP expert (not just the farmer) must sign the control off. |
| `evidence_spec` | array | One entry per artifact the system should prompt the user to provide. |
| `references` | array | Citation back to the source standard for traceability. One entry per cited AMS control; `locator` uses canonical XLSX worksheet+row form. |
| `ams_ids` | array | Verbatim USDA AMS HGAP control identifier(s) (e.g. `["G-2.1"]`). Empty array = SmartFarm-added with no direct AMS analogue. Added in `ruleset_revision 0.3.0`. |
| `ams_mapping_note` | string (optional) | Free-text note explaining bundling, partial mapping, or SmartFarm additions when the cross-walk is non-trivial. Added in `ruleset_revision 0.3.0`. |
| `applicability_condition` | object (optional) | Structured condition for controls that only apply in certain operating contexts. If omitted, the control is always applicable. Added for Phase 4.1 planning so conditional AMS rows can be modeled without reviewer folklore. |

`evidence_spec[]` entries:

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | enum | `photo`, `document`, `note`, `measurement`, `log_record`. |
| `guidance` | string | Concrete, farmer-readable description of the artifact. |

`applicability_condition`:

| Field | Type | Notes |
| --- | --- | --- |
| `fact` | string | Stable tenant/profile fact path the product can evaluate, e.g. `food_safety_plan.requires_laboratory_analysis`. |
| `operator` | enum | `equals`, `not_equals`, `includes`, `not_includes`, `exists`, `not_exists`. |
| `value` | string \| number \| bool \| array (optional) | Comparison value. Required for all operators except `exists` / `not_exists`. |
| `rationale` | string | Auditor-readable explanation of why the condition controls applicability. |
| `recordStatusWhenFalse` | enum | Current rule: must be `not_applicable`. When the condition is not met, the control stays visible in the record but is closed as not applicable rather than missing. |
| `guidance` | string (optional) | Farmer/reviewer-facing capture guidance for how to justify the not-applicable outcome. |

### Conditional applicability example

USDA H-GAP G-5 Laboratory Analysis is the first expected use case. Example
future control metadata:

```json
{
  "id": "HGAP.GQ.5.1",
  "title": "Laboratory analysis program is documented when required by the food safety plan",
  "applicability_condition": {
    "fact": "food_safety_plan.requires_laboratory_analysis",
    "operator": "equals",
    "value": true,
    "rationale": "USDA H-GAP G-5 laboratory analysis controls only apply when the food safety plan calls for laboratory testing.",
    "recordStatusWhenFalse": "not_applicable",
    "guidance": "When false, keep the control in the audit record as not applicable and cite the approved food safety plan section showing no laboratory testing requirement."
  }
}
```

The currently published `1.2.0` ruleset does not yet use this field; readers
must remain backward compatible with rulesets that omit it.

## Conditional control runtime guidance

Conditional controls must stay audit-traceable. Product behavior should be:

1. Farmer sees the control and the applicability rationale, not a hidden rule.
2. If the condition evaluates false, the UI records the control as `not_applicable`
   and captures the fact source or note that justified the result.
3. If the condition evaluates true, the control behaves like any other control:
   evidence, review, and corrective-action flows still apply.
4. If the product cannot evaluate the fact cleanly, the control should remain
   visible as review-needed rather than silently skipped.

Reviewer guidance:

- `not_applicable` is acceptable only when the record points to the fact that
  satisfied the condition test, such as the approved food safety plan or a
  tenant profile setting.
- Missing evidence on a conditionally inactive control is **not** a finding.
- If the reviewer disagrees with the recorded fact, they should reopen the
  control as applicable and document the override reason in the audit record.

The `evidence_kind_vocabulary` block at the top of the JSON file defines each
kind. Engineering should treat that block as the source of truth for the
evidence-kind enum; do not invent new kinds in the ruleset without updating
the vocabulary block in the same revision.

## Top-level metadata

`scheme`, `scheme_long_name`, `version`, `checklist_version`, `ruleset_revision`,
`effective_date`, `status`, `source_url`, `source_document`, `source_documents`,
`license_note`, `scope`, `schema`, `evidence_kind_vocabulary`, `ams_crosswalk_note`,
`controls`.

- `version` tracks the **AMS standard version** (e.g. `3.1`).
- `checklist_version` tracks the **AMS Combined Checklist version** that pairs
  with the standard (e.g. `6.2`). The two are versioned independently by USDA.
- `effective_date` is the AMS effective date for the cited standard+checklist
  pair (currently `2025-07-03`).
- `ruleset_revision` tracks **our** revisions of the same standard version
  (semver). Reaches `1.0.0` once all cross-walks are reviewed and a second
  reviewer signs off.
- `status` will move from `draft` to `review` to `published` as the GAP
  Compliance Expert and a second reviewer sign off.
- `source_documents[]` lists URLs to the canonical AMS Standard PDF and the
  Combined Checklist (XLSX + PDF). The XLSX is the authoritative source for
  control numbering since it has structured worksheet+row addressing.

## Versioning policy

1. Bump `ruleset_revision` (semver) for any change to the controls list.
   - Patch: typo, clarification, evidence guidance text fix.
   - Minor: new control points added under the same scheme version.
   - Major: control id removed, control split, semantic change to an existing
     id, or evidence_kind vocabulary change.
2. When the upstream standard publishes a new version (e.g. `2025.2`), create
   a new file (`usda-hgap-v2025_2.json` or similar). Do not mutate prior
   files. Engineering binds an organization to a specific scheme+version pair
   so audits remain reproducible.
3. Never reuse a control `id` for a different requirement. If a requirement
   is removed, drop it from future files but keep the historical file intact.

## Adding a new scheme later

1. Add a new file in this directory, e.g. `globalgap-ifa-v6.json`.
2. Use the same top-level metadata + per-control schema. The `scheme` field
   namespaces ids (e.g. `GGAP.AF.1.1` vs `HGAP.GQ.1.1`).
3. Define any new `evidence_kind` values in that file's
   `evidence_kind_vocabulary` block; coordinate with engineering before
   adding kinds, since UI capture flows are wired per kind.
4. Update this README's "v1 file of record" section to list the new file.

## Coverage status of v1

Current revision: `1.2.0` (published). Coverage at this revision:

- Total controls in file: **81**.
- AMS base worksheet coverage: **126 of 126** rows mapped
  (`72/72` General Questions, `54/54` Field Operations).
- Remaining uncovered base rows: **0**.

### What 1.2.0 added

- Closed the full approved Phase 4.2 Field Operations delta from **OME-108**:
  - `F-1.2`, `F-1.3` land-use infrastructure controls
  - `F-4.4`, `F-4.5` agricultural-water treatment and microbial die-off controls
  - `F-6.3` non-animal-origin growing media handling
  - `F-7.2.c`, `F-7.3`, `F-7.5`, `F-7.6` sanitation-verification, chemical-hazard, and water-tank controls
  - `F-9.4`, `F-9.6` reused-water treatment and wash-water-temperature controls where applicable
  - `F-10.1`-`F-10.4` harvest-container storage/inspection/dedicated-use bundle
  - `F-11.4`, `F-12.2` produce-contact materials / wiping-material controls
- No new SmartFarm-only controls were introduced in `1.2.0`; the uplift is strictly a base AMS coverage close-out.

### AMS cross-walk

Every control carries an `ams_ids[]` array citing the verbatim USDA AMS
HGAP Combined Checklist v6.2 control identifier(s) it derives from. The
canonical inventory is generated from the live ruleset and stored in:

- `compliance/_ams-coverage-section-b.md`
- `compliance/_ams-coverage-section-b.json`

Locator format remains the canonical XLSX worksheet+row address (for example,
`Checklist-General Questions (xl/worksheets/sheet5.xml) row 12` for `G-2.1`).

### SmartFarm-added controls without AMS analogue

Three controls still carry `ams_ids: []`:

- `HGAP.GQ.2.4` - Training delivered in language workers understand.
- `HGAP.GQ.8.1` - Pest monitoring program. In `1.1.0` this is explicitly
  marked as a deprecated SmartFarm-added compatibility control so it is not
  confused with AMS G-8 Corrective Action requirements.
- `HGAP.GQ.10.2` - Outbound carrier pre-load inspection.

### Coverage gap vs. full AMS Combined Checklist v6.2

There is no remaining base-worksheet coverage gap in `1.2.0`. The ruleset now
covers the full AMS Combined Checklist v6.2 General Questions + Field
Operations base scope.

Still out of scope for this base file:

- Optional AMS addenda and non-base modules unless separately approved and scoped.
- Commodity-specific tightening beyond the published overlays.
- Long-term disposition of the SmartFarm-added compatibility controls listed below.

### Release history and open follow-ups

Resolved through `1.2.0`:

- `1.0.0` published the reviewed 46-control base ruleset and cross-walk.
- `1.1.0` shipped the approved Phase 4.1 expansion and reduced the uncovered
  AMS base delta from 59 rows to 17 rows.
- `1.2.0` shipped the approved Phase 4.2 Field Operations expansion, added 12
  new `HGAP.FO.*` controls, and brought AMS base coverage to `126/126` rows.

Open follow-ups:

- **Structured conditional applicability** - `HGAP.GQ.1.9` uses a temporary
  reviewer-facing fallback note until `applicability_condition` support lands
  under **OME-104**. Several conditional-in-practice `1.2.0` Field Operations
  controls currently use the same reviewer-note fallback rather than structured
  applicability metadata.
- **PDF page locators on `references[]`** - XLSX worksheet+row remains the
  source of truth until PDF extraction is available.
- **SmartFarm-added control disposition** - `HGAP.GQ.2.4`, `HGAP.GQ.8.1`,
  and `HGAP.GQ.10.2` still need a long-term base-vs-addendum decision.
- **Optional addenda / new overlays** - keep them out of the base file unless a
  future issue explicitly scopes and approves them.

## Engineering integration notes (coordinated with OME-3)

- Treat the file as immutable once `status: published`. Loading is a one-shot
  parse at app boot or on tenant-scope refresh.
- Persist `(scheme, version, ruleset_revision)` on the tenant's audit profile
  so reports can reproduce the exact ruleset used at audit time. Note: with
  the introduction of `checklist_version` in `0.3.0`, also persist that
  field; reports must cite both the standard and the checklist version.
- The `evidence_required` and `expert_review_required` flags map directly to
  the reviewer status state machine in OME-3 phase 2 (`missing`,
  `needs-review`, `met`, `corrective-action-open`).
- `evidence_spec[]` entries should drive the evidence-capture prompts in the
  3-screen mobile flow (`EVIDENCE_CAPTURE_UX.md`), one prompt per entry.

## Source

USDA AMS Harmonized GAP Field Operations and Harvesting checklist:
https://www.ams.usda.gov/services/auditing/gap-ghp/harmonized

USDA AMS checklist content is U.S. government work and not subject to
copyright. The operational paraphrasing in our ruleset is for product
implementation; the canonical audit-of-record text remains the AMS document.
