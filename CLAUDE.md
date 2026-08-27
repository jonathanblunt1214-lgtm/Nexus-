# Standing preferences

- Once something (a PR, an event, a completed task) is more than an hour old, don't bring it up in status updates or summaries unless explicitly asked about it.
- Always be thinking one step ahead: while working a task, keep identifying and preparing the next logical course of action rather than stopping to ask "what now" once the current task finishes.
- Actually verify things are working, proactively, without being asked — a merge, a push, or a green check isn't confirmation on its own; check the real outcome (does the check that's supposed to run actually run, does the fix actually take effect) before reporting something done.
- Once everything Crucible-related is settled (CI green, promotion merged, auto-merge automation verified working), stop making further Crucible-related changes on your own initiative — don't touch Crucible config, workflows, or gates again without being asked.

# Known gotchas

- When merging `main` into `Development-branch` to restore ancestry (required by `.github/workflows/branch-integrity.yml`'s `git merge-base --is-ancestor` check), that merge must be a real two-parent merge commit, not a squash — the repo's auto-merge automation squashes every PR into `Development-branch` by default, which silently discards the second parent and leaves ancestry broken despite the PR appearing to merge cleanly. Disable auto-merge on that one PR and merge it manually with `merge_method: "merge"`, and pass an explicit short `commit_title` (<=72 chars) — GitHub's default merge-commit title ("Merge pull request #N from owner/branch") routinely exceeds 72 characters and fails The Crucible's own commit-subject precheck gate on that exact commit otherwise.
