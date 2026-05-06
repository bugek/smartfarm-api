# OME-100: Audit Packet Export Phase 1.1 Sequencing Note

This note records the board sequencing update from 2026-05-06 for
`OME-19c Audit Packet Export Spec (v1)`.

Assumption: the PM-owned spec file `OME-19c_AUDIT_PACKET_EXPORT_SPEC.md`
referenced in the Paperclip issue is not present in this repository today.
Rather than recreate that document from issue text alone, this note captures the
engineering follow-up needed to keep the export design aligned with the current
Phase 1.1 launch sequence.

## Sequencing Decision

Treat audit packet export as a follow-on slice after these are stable:

- the live review workflow
- the corrective-action loop derived from review threads
- the readiness surface that synthesizes record, evidence, and review state

Do not lock the final packet packaging contract before those upstream surfaces
ship. The export should package stable source-of-truth outputs, not force those
upstream models to bend around a premature archive format.

## What This Means For OME-100

For the current heartbeat, the practical deliverable is not a final ZIP/package
spec. It is an engineering boundary for the later spec revision:

- packet generation should consume the readiness surface that OME-19a defines
- corrective-action sections should derive from review-thread and evidence
  review state, not from a separate first-pass corrective-action table
- evidence attachments should reuse immutable document/evidence blobs and their
  hashes rather than introduce packet-specific binary storage semantics
- reproducibility should anchor on a canonical manifest/JSON payload, with the
  PDF treated as a rendered presentation layer

## Preliminary Engineering Answers For The Future Spec

These answers are intentionally provisional until the upstream workflow and
readiness outputs are finished.

### 1. PDF Toolchain

Prefer HTML-to-PDF rendering with Playwright/Chromium when export work starts.

Why:

- this backend is already TypeScript/Node, so the runtime fit is practical
- the cover page, summary tables, and appendix-style sections are easier to
  evolve in HTML/CSS than in low-level PDF drawing code
- the issue already relaxes PDF byte-equivalence, so layout fidelity matters
  more than strict binary determinism

### 2. Snapshot Strategy

Build the packet from a single repeatable-read database snapshot plus immutable
evidence blob references.

Implications:

- the readiness summary, review-thread state, corrective-action derivation, and
  audit-log appendix must all be queried from one consistent DB snapshot
- evidence files should be referenced by content-addressed blob/hash identity so
  the export does not depend on mutable filenames or object keys alone
- the canonical reproducibility anchor should be a manifest-style JSON payload
  produced from that snapshot, then hashed

### 3. Object-Store Reuse

Reuse the existing blob/object storage path for generated packet artifacts, but
store packet outputs under a separate namespace/prefix from raw evidence.

That keeps:

- evidence blobs immutable and reusable across generations
- generated packet archives replaceable as implementation detail without
  touching evidence storage semantics
- retention and cleanup rules separable between source evidence and derived
  export artifacts

### 4. Regeneration Semantics

Do not finalize regeneration behavior until the readiness payload is stable.

Current recommendation:

- if the canonical manifest hash changes, create a new immutable generation
- if the canonical manifest hash does not change, it is acceptable to reuse the
  prior generation artifacts or short-circuit the work, but still record that a
  regeneration was requested

That preserves immutable history where inputs changed without inventing
duplicate packet rows for no-op re-renders before product pressure proves it is
useful.

## Constraints The Final Spec Should Preserve

- Keep all packet source queries organization-scoped.
- Treat review/audit history as append-only source-of-truth data.
- Prefer additive schema for packet history and artifacts.
- Do not duplicate corrective-action persistence before the derived workflow
  proves insufficient.
- Make the readiness payload and canonical manifest the contract boundary; the
  ZIP member list should follow from that boundary, not define it.

## Recommended Next Action

Resume final audit packet spec work only after the live workflow and readiness
surface are implemented and their payload shape is concrete. At that point:

1. append the engineering addendum to the PM spec
2. lock the canonical manifest fields from the real readiness payload
3. define packet history/object-store schema against those stable inputs
