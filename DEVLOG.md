# Nexus Dev Log

A running log of notable AI-agent-driven changes to this repository, and a
plain-language explanation of the governance that keeps multiple AI agents
(Claude, Codex, Gemini, Copilot, or anything else) working on Nexus without
stepping on each other. The binding rules live in `AGENTS.md`; this file
and `AI-HANDOFF.json` are the readable summary and the machine-readable
index of that same policy, kept in sync with it.

## Plain-language: AI conflict governance

If two AI agents — or two separate runs of the same agent — make changes
that could clash, that clash gets written down as an entry in
`AI-CONFLICTS.json` instead of one side silently overwriting the other. Any
conflict entry that's still open or incomplete blocks The Crucible CI gate,
so nothing broken can be promoted to `main` while a real conflict sits
unresolved. Nobody force-pushes, deletes, renames, or overwrites a branch
just to make a conflict disappear — it gets resolved and the resolution is
recorded.

## Plain-language: agent communication policy

Every attended progress or completion check-in an AI sends to the
repository owner must open with a timestamp, written as
`YYYY-MM-DD HH:MM:SS EDT/EST` (e.g. `2026-08-28 08:10:42 EDT`). That way the
owner can tell how fresh a status update is at a glance, and anyone
reading back later — including a different AI agent picking up the work —
can reconstruct the real order of events across multiple agents and
sessions. The full policy is recorded in `AI-HANDOFF.json` under
`agentCommunicationPolicy`.

## Plain-language: branch authority

Ordinary AI work happens only on `Development-branch`. An AI doesn't create
or use `claude/*`, `codex/*`, or other auxiliary branches, and doesn't
touch `main` directly, unless the repository owner explicitly authorizes
that exact branch or operation in the current conversation — and that
authorization doesn't carry over to the next task. `main` only changes
through the protected `promote-development-to-main.yml` workflow. The full,
binding rules are in `AGENTS.md`.

## Log

- **2026-08-28** — Added `AI-HANDOFF.json`, this file, and the
  agent-communication timestamp policy, per the repository owner's request.
