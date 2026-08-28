# Nexus native governance assimilation

This document records the compatibility reconciliation between the Crucible-injected governing documents in this directory and Nexus's native AI-governance documents copied under `native/`.

## Baseline preservation

The Crucible-injected documents remain the baseline and are not overwritten by this assimilation. The native root documents also remain in place. Their copied snapshots live under `governingDocuments/native/` for auditable comparison and future synchronization.

## Compatible rules assimilated

- **Agent progress and timestamps:** `agent-progress-policy.md` requires attended progress/completion timestamps in America/New_York and periodic substantive progress updates. Nexus's native `AGENTS.md`, `AI-HANDOFF.json`, and `DEVLOG.md` already require the same timestamp format. The Crucible policy therefore remains authoritative as the detailed governing rule, with the native timestamp rule treated as a compatible repository-specific reinforcement.
- **AI conflict handling:** `ai-conflict-resolution.md` requires contested mutations to freeze, both sides to be preserved, conflicts to be recorded, and force-push/overwrite resolution to be avoided. Nexus's native `AGENTS.md`, `AI-HANDOFF.json`, `AI-CONFLICTS.json`, and `DEVLOG.md` require the same preservation and ledger behavior. These rules are compatible and cumulative.
- **Branch authority:** Nexus's native governance adds the repository-specific rule that ordinary AI work is confined to `Development-branch`, auxiliary branches require explicit owner authorization, and `main` changes only through the authorized promotion path unless the owner explicitly authorizes the exact exception. Nothing in the injected Crucible documents grants broader branch authority, so this native restriction is assimilated as an additional Nexus-specific constraint.
- **Required-check rollout:** `required-check-rollout.md` requires staged rollout, exact check-name verification, explicit owner approval for protection changes, and no security weakening. Nexus's native branch and verification rules are compatible and remain cumulative.
- **Truthful verification and safety:** Nexus's native `CONSTITUTION.md` requires truthful telemetry, no optimistic completion claims, gated verification, approved side-effect channels, and security precedence. These requirements complement the injected progress/conflict/check policies and remain effective.
- **Temporary external write window:** The Crucible's permission to write under `governingDocuments/` remains limited to the owner-authorized window ending `2026-08-29 08:43:34 EDT`. This assimilation is an internal Nexus operation and does not extend, renew, or broaden that external-write authority.

## Conflict result

No irreconcilable rule conflict was found during this assimilation. If a future injected document introduces a rule that cannot coexist with Nexus native governance, preserve both sources and record the conflict in root `AI-CONFLICTS.json` before any contested mutation proceeds.
