# Required GitHub check rollout plan

Use this plan whenever Nexus introduces a workflow whose check will later become required by branch protection or a ruleset.

## Safe enforcement boundary

1. Add the workflow on `Development-branch` and run it in report-only or non-enforcing mode first.
2. Verify the exact check name and behavior on `Development-branch`. Do not activate a required-check rule yet.
3. Record the workflow path, exact check name, protected branch, verification evidence, and promotion decision in the shared handoff/development log.
4. Obtain explicit repository-owner approval before promotion or protection changes. Never infer approval from adjacent work.
5. After the workflow is present on the protected branch through the repository's authorized promotion path, verify that a representative pull request actually produces the exact named check.
6. Only then may a separately authorized actor add that exact check to branch protection or a ruleset.
7. Re-fetch protection after the change and verify the check is required without weakening any existing protection.

## Stop conditions

Stop without changing repository settings if promotion is unapproved, the workflow is absent from the protected branch, the exact check name is uncertain, a representative pull request has not produced it, or enabling it would remove/weaken another existing protection. Report the unmet condition and preserve the current protections.

## No green-by-weakening rule

Never disable, rename around, bypass, or reduce a security/governance check merely to make CI pass. Fix the underlying condition or leave the check failing with a clear recorded blocker.
