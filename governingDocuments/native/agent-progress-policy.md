# Attended AI progress and completion policy

This is a mandatory governing document for every AI agent working in Nexus. It supplements `AGENTS.md`; higher-priority platform, safety, repository, and tool constraints still control when they conflict.

## User-visible progress must not disappear

For an attended task that takes more than a trivial single response, the agent must keep the owner visibly informed while it works.

- Send an initial progress update before extended work begins.
- While work continues, send another user-visible update at least once every 60 seconds, and normally after every 2-3 substantive tool/action calls when that happens sooner. Do not allow a long-running task to go silent merely because tools are still being used.
- Each progress update must say what has completed, what is happening now, and any real blocker or verification still outstanding. Do not emit empty heartbeat text that gives no state.
- Every attended progress update and completion/interruption check-in must begin with an explicit America/New_York timestamp in the form `YYYY-MM-DD HH:MM:SS EDT` while daylight-saving time is active or `YYYY-MM-DD HH:MM:SS EST` otherwise. Do not use ambiguous `ET`, UTC-only timestamps, or a fixed EST label during EDT.

## Completion-time statements

- When an exact completion time is mechanically known from an already scheduled event, deadline, or externally fixed execution, include that exact America/New_York timestamp.
- When the finish time is not mechanically knowable and the owner requests a completion time, provide a best-effort estimate explicitly labeled as an estimate. The estimate is planning information, not a guarantee; update it if observed work materially changes the estimate.
- Never present an estimate as a mechanically fixed completion time or guarantee.

## Mandatory completion and interruption check-ins

- As soon as the attended task is actually complete, send a completion check-in automatically in the same session. Include the America/New_York completion timestamp, concrete result, verification state, and relevant commit/run identifiers when applicable.
- If a task cannot complete because of a hard usage limit, tool/session limit, unavailable required capability, safety boundary, repository-governance stop condition, or explicit owner stop, send an immediate timestamped interruption check-in. State exactly what completed, why execution stopped, and exactly what remains.
- Do not claim background or asynchronous work. A completion check-in is emitted only when completion is actually observed in the attended session.

## Continue-until-done rule

For safe, in-scope work the owner has authorized, do not voluntarily stop, defer, hand the work back, or declare partial work sufficient while executable work remains. Continue through implementation, correction, and required verification until the task is complete, or until a hard usage/tool/session limit or a higher-priority platform, safety, repository, or owner-governance boundary prevents further execution. If stopped by such a boundary, use the mandatory interruption check-in above rather than going silent.
