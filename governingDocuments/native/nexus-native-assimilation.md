# Nexus native governance assimilation

This directory is the consolidated Nexus governance set. It contains both the Crucible-injected governance documents and the Nexus-native governing documents copied from the repository root.

## Consolidated baseline

Crucible-originated governing documents and Nexus-native governance now live together under `governingDocuments/native/`. The repository-root native documents remain in place for compatibility and existing consumers. Consolidation does not erase provenance or broaden authority.

## Compatible rules assimilated

- **Agent progress and timestamps:** `agent-progress-policy.md` requires attended progress/completion timestamps in America/New_York and periodic substantive progress updates. Nexus's native `AGENTS.md`, `AI-HANDOFF.json`, and `DEVLOG.md` reinforce that requirement.
- **AI conflict handling:** `ai-conflict-resolution.md` requires contested mutations to freeze, both sides to be preserved, conflicts to be recorded, and force-push/overwrite resolution to be avoided. Nexus's native `AGENTS.md`, `AI-HANDOFF.json`, `AI-CONFLICTS.json`, and `DEVLOG.md` require compatible preservation and ledger behavior.
- **Branch authority:** Nexus's native governance confines ordinary AI work to `Development-branch`, requires explicit authorization for auxiliary branches, and restricts `main` changes to the authorized promotion path unless the owner explicitly authorizes the exact exception.
- **Required-check rollout:** `required-check-rollout.md` requires staged rollout, exact check-name verification, explicit owner approval for protection changes, and no security weakening.
- **Truthful verification and safety:** `CONSTITUTION.md` requires truthful telemetry, no optimistic completion claims, gated verification, approved side-effect channels, and security precedence.
- **Temporary external write window:** The Crucible's permission to write under `governingDocuments/` remains limited to the owner-authorized window ending `2026-08-29 08:43:34 EDT`. This consolidation is an internal Nexus operation and does not extend, renew, or broaden that external-write authority.

## Conflict result

No irreconcilable rule conflict was found during consolidation. If a future governing document introduces a rule that cannot coexist with the existing consolidated set, preserve both sources and record the conflict in root `AI-CONFLICTS.json` before any contested mutation proceeds.
