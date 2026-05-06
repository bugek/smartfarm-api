# AGENTS.md

Instructions for contributors and coding agents working in `smartfarm-api`.

## Workflow Mode

This repository uses a **branch + pull request** workflow.

- Do not push feature work directly to `main`.
- Create a branch for each issue or scoped task.
- Push the branch to GitHub.
- Open a pull request for review and traceability.

## Branch Naming

Use one of these patterns:

- `feat/ome-<number>-<slug>`
- `fix/ome-<number>-<slug>`
- `docs/ome-<number>-<slug>`
- `chore/ome-<number>-<slug>`

Examples:

- `feat/ome-15-document-storage`
- `feat/ome-10-tenancy-model`

## Pull Request Rules

- Title format: `[OME-15] Add document storage metadata service`
- Link the Paperclip issue in the PR body.
- Keep PRs scoped to one issue or one tightly related slice.

## Engineering Focus

Current priorities:

1. tenancy and role enforcement
2. audit-safe write paths
3. evidence and document metadata
4. GAP-first API surfaces

## Safety

- Prefer additive schema and API changes.
- Keep all records organization-scoped.
- Preserve append-only audit history.

