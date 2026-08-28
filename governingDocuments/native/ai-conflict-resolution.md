# Repository-independent AI conflict resolution

Use this policy whenever AI agents may act in Nexus. It applies to conflicts between agents, instructions, plans, branch policies, concurrent changes, automation, and claimed prior decisions.

## Required resolution sequence

1. Detect: treat two directions as conflicting when both cannot be followed without changing, discarding, bypassing, or weakening either one.
2. Freeze only the contested mutation. Continue safe read-only investigation and unrelated work when it cannot prejudice the decision.
3. Preserve both sides verbatim where possible. Do not silently choose the newest, most convenient, or most permissive instruction.
4. Record the sources, affected files/settings/branches, current state, evidence, and reversible options in `AI-HANDOFF.json`, `DEVLOG.md`, and the structured `AI-CONFLICTS.json` ledger as applicable.
5. Apply standing repository rules and explicit scope boundaries. They can rule out an action, but an AI must not invent an exception or broaden its authority.
6. If a real conflict remains, ask the repository owner for an explicit decision. Permission for adjacent work does not resolve it.
7. After the decision, record the owner's resolution, make only the authorized change, and verify the result. Never rewrite history to hide the conflict.

## Concurrent-work rule

A branch moving while an agent is preparing a commit is evidence of concurrent work, not permission to overwrite it. Re-read the new tip, reconcile the intended change against it, and fast-forward only. Never force-push merely to make an automated write succeed.

## Completion integrity

Do not claim a conflict is resolved, a check is green, or a task is complete unless the corresponding state was actually observed. Ambiguous or incomplete evidence stays explicitly unresolved.

This is an auditable decision record, not private chain-of-thought. Record disclosed evidence, alternatives, decisions, and outcomes only.
