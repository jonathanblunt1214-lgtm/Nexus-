# Standing preferences

## Non-negotiable branch authority

- Read and follow `AGENTS.md` before any repository action.
- Do all ordinary work directly on literal `Development-branch`.
- Do not create or update `claude/*` or any other auxiliary branch without the repository owner's explicit authorization for that exact branch in the current conversation.
- Do not push or merge directly to `main` without an explicit instruction for that exact operation. Prior permission is not reusable.
- Never change or bypass the `AI branch scope - development only` ruleset. Shared owner credentials do not grant an AI owner authority.

- Always work in order of criticality: when a request has multiple parts (or a follow-up adds one), do the highest-stakes/most-blocking item first, then move down the list — don't default to request order or convenience order.
- Once something (a PR, an event, a completed task) is more than an hour old, don't bring it up in status updates or summaries unless explicitly asked about it.
- Always be thinking one step ahead: while working a task, keep identifying and preparing the next logical course of action rather than stopping to ask "what now" once the current task finishes.
- Actually verify things are working, proactively, without being asked — a merge, a push, or a green check isn't confirmation on its own; check the real outcome (does the check that's supposed to run actually run, does the fix actually take effect) before reporting something done.
- Once everything Crucible-related is settled (CI green, promotion merged, auto-merge automation verified working), stop making further Crucible-related changes on your own initiative — don't touch Crucible config, workflows, or gates again without being asked.

# Known gotchas

- When `main` must be merged into `Development-branch` to restore ancestry, work directly in the existing `Development-branch` checkout and create a real two-parent merge commit there after synchronizing both refs. Never create a temporary synchronization branch or PR for this. Verify the combined tree, then push only `Development-branch`. If repository protections make that impossible, stop and obtain an explicit owner decision; do not route around the branch boundary.
