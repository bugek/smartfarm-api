# OME-19c Audit Packet Export Spec (v1)

Status: repo-local working copy for SmartFarm API.

This file captures the v1 audit packet export contract described in
[OME-100](/OME/issues/OME-100) and appends the engineering response requested in
Section 13. It exists because the PM-owned project-root spec referenced in the issue
was not present in this repository when engineering review resumed.

The board sequencing update from 2026-05-06 remains in
`docs/OME-100_AUDIT_PACKET_EXPORT_PHASE_1_1_NOTE.md`. The decisions there are
now folded into Section 13 so this file can serve as the durable repo-local handoff.

## 1. Why This Exists

Audit packet export is the discharge-of-evidence step that closes the GAP loop.
Maria needs one reproducible export package she can hand to an auditor without
requiring live system access.

The packet must combine:

- readiness summary data
- control-by-control evidence and review posture
- open and closed corrective-action history
- append-only audit history
- a canonical manifest suitable for reproducibility checks

## 2. Scope

In scope for v1:

- one exportable packet per farm site and audit window
- five archive members: cover PDF, canonical JSON payload, evidence bundle,
  audit-log CSV, and manifest
- immutable generation history
- asynchronous generation and later retrieval
- regeneration against the same farm/audit-window boundary

Out of scope for v1:

- handwritten PDF byte-for-byte determinism
- live auditor portal access
- packet editing after generation
- mutable packet rows
- derived AI extraction payloads inside the manifest
- packet-scoped evidence copies that diverge from source blobs
- cross-organization exports
- notification/reminder workflow
- pilot deployment/backup hardening beyond the packet contract itself

## 3. Persona Flows

### Maria generates a packet

1. Maria selects a farm site and audit window.
2. SmartFarm queues packet generation.
3. Maria returns to the packet history view and downloads the completed packet.

### Maria regenerates a packet

1. Maria requests a new generation for the same farm site and audit window.
2. SmartFarm compares the canonical manifest input state.
3. SmartFarm either produces a new immutable generation or records a no-op
   regeneration against the unchanged canonical state.

### Auditor consumes the packet offline

1. Auditor opens the cover PDF for overview context.
2. Auditor checks the manifest and canonical JSON for reproducibility metadata.
3. Auditor reviews evidence files and audit-log CSV without needing API access.

## 4. Packet Contents

The packet should contain:

1. `cover.pdf`
   Includes farm identity, audit window, packet generation metadata, pinned
   ruleset version, readiness summary, and section-level overview.
2. `audit-packet.json`
   Canonical machine-readable export containing the readiness summary, control
   sections, evidence manifest, review history, corrective-action history, and
   ruleset pin metadata.
3. `evidence/`
   Referenced evidence artifacts copied or streamed from immutable source blobs
   under names derived from the canonical manifest.
4. `audit-log.csv`
   Append-only audit history relevant to the packet scope.
5. `manifest.json`
   Archive member inventory including hashes, content types, generation
   metadata, and the canonical manifest hash anchor.

The cover PDF is presentation output. `audit-packet.json` is the canonical
reproducibility surface.

## 5. Packet History Surface

The product should expose a generated-packets history surface with, at minimum:

- generation number
- farm site and audit window
- job status
- requested at / completed at
- requested by
- canonical manifest hash
- ruleset pin
- failure reason when generation fails

## 6. Reproducibility Model

The canonical reproducibility anchor is the SHA-256 of `audit-packet.json`.

Rules:

- PDF byte-equivalence is explicitly relaxed.
- Evidence members must be tied to immutable blob identity and hash.
- Ruleset/version metadata must be pinned to the exported farm state, not looked
  up from mutable current catalog rows at download time.
- Regeneration must compare canonical input state, not just timestamps or UI
  filters.

## 7. Async Job and API Shape

The intended v1 surface is:

- `POST /api/v1/audit-packets`
- `GET /api/v1/audit-packets`
- `GET /api/v1/audit-packets/:id`
- `GET /api/v1/audit-packets/:id/download`
- `GET /api/v1/audit-packets/:id/cover-pdf`
- `POST /api/v1/audit-packets/:id/regenerate`

Job states:

- `queued`
- `running`
- `ready`
- `failed`

## 8. Proposed Persistence Shape

One `audit_packet` row represents one immutable generation.

Minimum fields:

- `id`
- `organizationId`
- `farmSiteId`
- `auditWindowStart`
- `auditWindowEnd`
- `generationNumber`
- `status`
- `requestedByUserId`
- `requestedAt`
- `completedAt` nullable
- `failedAt` nullable
- `failureReason` nullable
- `rulesetCode`
- `rulesetVersionLabel`
- `rulesetVersionId`
- `rulesetSourceSha256`
- `canonicalManifestSha256`
- `manifestStorageKey`
- `coverPdfStorageKey` nullable
- `archiveStorageKey` nullable
- `inputSnapshotJson` or equivalent canonical input payload reference

Constraints:

- rows are immutable after completion except for job-state progression while the
  generation is still running
- unique key on `(farmSiteId, auditWindowEnd, generationNumber)`
- organization scoping on every read/write path
- canonical manifest hash stored at generation time
- ruleset pin captured at creation time

## 9. Performance Bar

Target generation time is under 60 seconds p95 for a pilot-scale farm site.

Correctness matters more than latency. Packet generation must use one
repeatable-read snapshot for the relational inputs so readiness summary,
corrective-action derivation, evidence manifest, and audit-log appendix cannot
drift mid-generation.

## 10. Acceptance Boundary

The acceptance shape remains fixture-grounded:

- a farm with intentional findings must surface matching open/closed
  corrective-action history in the packet
- packet enumeration must reflect the real control/evidence/review boundary
- regeneration with no canonical input change must preserve the same canonical
  manifest hash
- packet history must remain immutable across generations

## 11. Dependencies and Sequencing

This is the latest OME-19 child by design.

It depends on:

- OME-16 for pinned compliance/ruleset version storage
- OME-17 and OME-18 for farm/evidence/review data completeness
- OME-76 for the readiness/dashboard surface
- OME-83 for the corrective-action workflow boundary

The packet contract should package those upstream outputs; it should not force
them to change shape to satisfy a premature archive format.

## 12. Open Questions

The PM issue asked engineering to answer:

1. PDF toolchain choice
2. snapshot strategy
3. object-store reuse
4. regeneration semantics when no inputs changed

## 13. Engineering Addendum

### 13.1 PDF Toolchain

Use HTML-to-PDF rendering with Playwright/Chromium.

Why:

- it fits the current Node/TypeScript backend stack
- cover pages, summary tables, and appendix layouts are easier to evolve in
  HTML/CSS than in low-level PDF drawing code
- the contract already relaxes PDF byte-equivalence, so layout fidelity matters
  more than binary determinism

### 13.2 Snapshot Strategy

Generate the packet from a single repeatable-read database snapshot plus
immutable evidence blob references.

Implementation stance:

- the export query boundary must include readiness summary, section/control
  breakdowns, review history, and corrective-action derivation in one snapshot
- evidence members must reference blob SHA-256 and stable storage identity
- `audit-packet.json` should be assembled first, then hashed, then used as the
  canonical anchor for the rest of the archive

### 13.3 Object-Store Reuse

Reuse the existing document/evidence blob store, but keep generated packet
artifacts under a separate prefix or namespace from source evidence.

That gives us:

- immutable source evidence reuse across generations
- separable retention/cleanup rules for derived artifacts
- no packet-specific blob semantics leaking back into evidence ingestion

### 13.4 Regeneration Semantics

If the canonical manifest hash changes, create a new immutable generation.

If the canonical manifest hash does not change, do not fabricate a materially
different packet row just to satisfy the button press. It is acceptable to
reuse the prior generation artifacts or short-circuit the archive build, but
the system should still record that regeneration was requested in job/audit
history.

### 13.5 Schema Confirmation and Pushback

The proposed packet-history model is workable for OME-16 with the following
changes and clarifications:

- use `farmSiteId`, not `farm_id`
  SmartFarm runtime state is farm-site scoped today, and that is the tenant-safe
  boundary already used by the rest of the repo
- persist the ruleset pin from OME-16 explicitly
  Store `rulesetCode`, `rulesetVersionLabel`, `rulesetVersionId`, and
  `rulesetSourceSha256` on the packet row so exports remain reproducible after
  later ruleset changes
- treat corrective actions as derived for v1
  Per [OME-83](/OME/issues/OME-83), the packet should derive open/closed
  corrective-action sections from review-thread and evidence-review history
  unless product pressure later proves a dedicated packet-facing corrective
  action model is required
- keep canonical input data available
  Either store `inputSnapshotJson` directly or store a pointer to the canonical
  JSON payload used to derive the final archive so regeneration and audit review
  can explain exactly what was exported

This is the main pushback on the earlier PM draft: the packet schema is viable,
but it must pin to the farm-site/ruleset model defined in OME-16 instead of a
generic `farm_id` abstraction.
