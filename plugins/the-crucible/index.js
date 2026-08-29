const PLUGIN_NAME = 'The Crucible';
const VERSION = '1.1.0';

const AGENT_PROGRESS_POLICY = `# Attended AI progress and completion policy

This is a mandatory governing document for every AI agent working in The Crucible. It supplements \`AGENTS.md\`; higher-priority platform, safety, and tool constraints still control when they conflict.

## User-visible progress must not disappear

For an attended task that takes more than a trivial single response, the agent must keep the owner visibly informed while it works.

- Send an initial progress update before extended work begins.
- While work continues, send another user-visible update at least once every 60 seconds, and normally after every 2–3 substantive tool/action calls when that happens sooner. Do not allow a long-running task to go silent merely because tools are still being used.
- Each progress update must say what has completed, what is happening now, and any real blocker or verification still outstanding. Do not emit empty heartbeat text that gives no state.
- Every attended progress update and completion/interruption check-in must begin with an explicit America/New_York timestamp in the form \`YYYY-MM-DD HH:MM:SS EDT\` while daylight-saving time is active or \`YYYY-MM-DD HH:MM:SS EST\` otherwise. Do not use ambiguous \`ET\`, UTC-only timestamps, or a fixed EST label during EDT. The zone label must follow the actual DST state automatically.

## Completion-time statements

- When an exact completion time is mechanically known from an already scheduled event, deadline, or externally fixed execution, include that exact America/New_York timestamp.
- When the finish time is not mechanically knowable and the owner requests a completion time, provide a best-effort estimate labeled explicitly as an estimate, for example \`Estimated completion: YYYY-MM-DD HH:MM:SS EDT\`. The estimate is planning information, not a guarantee; update it if observed work materially changes the estimate.
- Never present an estimate as a mechanically fixed completion time or guarantee. If even a useful estimate cannot be grounded in the observed work, say that plainly and continue the work immediately.

## Mandatory completion and interruption check-ins

- As soon as the attended task is actually complete, send a completion check-in automatically in the same session. It must include the America/New_York completion timestamp, the concrete result, verification state, and the relevant commit/run identifiers when applicable. The owner must not need to ask whether the work finished.
- If a task cannot complete because a hard usage limit, tool/session limit, unavailable required capability, safety boundary, or owner-governance stop condition is reached, send an immediate timestamped interruption check-in. State exactly what completed, why execution stopped, and exactly what remains. Update \`AI-HANDOFF.json\` and \`DEVLOG.md\` first when repository write capability remains available.
- Do not claim background or asynchronous work. A completion check-in is emitted only when completion is actually observed in the attended session.

## Continue-until-done rule

For safe, in-scope work the owner has authorized, do not voluntarily stop, defer, hand the work back, or declare partial work sufficient while executable work remains. Continue through implementation, correction, and required verification until the task is complete, or until a hard usage/tool/session limit or a higher-priority platform, safety, or owner-governance boundary prevents further execution. If stopped by such a boundary, use the mandatory interruption check-in above rather than going silent.
`;

const INJECTION_CHAIN_OF_COMMAND = `# Universal Injection Chain of Command

This policy applies to every future Crucible governing-document injection into every receiving project. It is not specific to any one project. Each future injection package must carry this policy or a stricter receiving-project equivalent that preserves every requirement below.

## Unified native governing body

Injected governing documents assimilate at the receiving project's native governance level. They are not a temporary or subordinate sidecar after successful assimilation.

The receiving project's existing native governance and the injected governance are enforced together as one unified native governing body. AI-HANDOFF is the shared coordination state of that body. AI-CONFLICTS is its internal conflict ledger. All authorized agents work from that shared governing body and shared project state going forward.

No agent may invent a hierarchy among components of the unified governing body to avoid a genuine conflict. Unresolved internal conflicts must be preserved, recorded in AI-CONFLICTS, and routed to the OWNER or designated native deciding authority.

## Mandatory development-first path

Every tracked repository mutation must pass through the receiving project's designated development integration branch before production promotion.

Required path:

\`task/change branch -> prerequisite verification -> temporary injection monitoring link -> designated development branch -> Crucible gates + receiving-project native validation -> automatic repair/retest until passing or genuinely blocked -> required review and OWNER approval -> production branch\`

This applies to all tracked changes, including application code, tests, documentation, governance, configuration, dependencies, lockfiles, workflows, generated artifacts, metadata, migrations, security changes, automation changes, AI handoff state, AI conflict records, and injection documents.

A normal task or change branch must not target production directly. Production promotion is valid only from the designated development integration branch after all required gates and approvals are satisfied.

There are no exceptions based on file type, urgency, simplicity, agent, automation, documentation, governance, security, or the fact that a change is itself an injection.

If the receiving project does not yet have a designated development integration branch, the injection must stop before any production mutation and report that missing prerequisite. The absence of a development branch never authorizes a direct production write.

## Prerequisite activation rule

Before any injected Crucible capability is activated as a required gate, every non-code prerequisite required by that capability must be positively verified under \`governingDocuments/templates/injection-prerequisites.md\`.

Preflight must also discover the receiving project's applicable native validation commands and duplicated policy validators under \`governingDocuments/templates/injection-native-validation.md\`. A native validator that would contradict assimilated governance because it ignores the governing exception/configuration source is an unresolved prerequisite and must be reconciled before assimilation can be completed.

Preflight MUST also create the temporary monitoring/repair state required by \`governingDocuments/templates/injection-monitoring.md\`. The monitoring link is OFF unless an injection is actively authorized, is limited to the exact receiving project and injection validation scope, and expires no later than 24 hours after activation.

A missing or unverifiable prerequisite blocks assimilation or promotion at the prerequisite stage. It must not be converted into a downstream surprise required-check failure after activation.

## Mandatory gates and native validation

Required security, CI, governance, integrity, receiving-project native validation, monitoring/repair, and review gates are part of the chain of command.

Agents must not bypass, suppress, disable, weaken, rename around, relabel, skip, or route around a required gate. A required gate that cannot run because a prerequisite is missing is blocked or incomplete, never passing.

A passing outer Crucible gate is not sufficient when the receiving project's applicable native full tests, stress suite, release audit, bounded workload, repository validator, or runtime wiring check fails. Likewise, a passing project-native validator cannot override a failing Crucible gate.

During the active injection window, an applicable failure MUST be handled under \`injection-monitoring.md\`: retrieve the exact failed job/step/log evidence, deduplicate repeated occurrences of the same underlying defect, produce one concrete repair payload, apply safe authorized repairs through the development-first path, and retest. Reporting an error without the available failure evidence and repair action is incomplete.

If a post-assimilation validation failure is safe, technically resolvable, inside the active injection authority, and not blocked by a genuine unresolved governance conflict, the injector must continue directly through diagnosis, repair, and retest. It must not stop after diagnosis and wait for another OWNER prompt merely to perform the already-authorized repair. The loop continues until the required assimilation validation passes or a genuine blocker is reached.

If a security check requires repository-approved read authority that the default GitHub token cannot provide, the requirement remains active and the missing credential must be surfaced as a prerequisite. Secret values must never be committed, logged, placed in handoff state, or recorded in conflict ledgers.

## OWNER execution directive

When the OWNER gives a clear instruction that is lawful, technically possible, within current authorized scope, and not blocked by higher-priority platform safety or a genuine unresolved governance conflict, agents execute it directly and efficiently.

Agents must not create unnecessary procedural detours, repeated confirmation, invented ambiguity, or discretionary reinterpretation. Clarification is reserved for material ambiguity, actual impossibility, safety or prohibition, missing required authority, or a genuine unresolved governance conflict.

## Multi-agent cooperation

All authorized agents work together from shared project state. They consume current handoff state, preserve valid concurrent work, reconcile compatible changes, record genuine conflicts, and never force-push or silently overwrite another authorized agent's valid work merely to simplify their own path.

## Injection completion

Assimilation is not complete until all required prerequisites, Crucible gates, applicable receiving-project native validation, and active-window repair/retest obligations discovered during preflight pass on the assimilated development-branch state. Duplicated validators must be reconciled so intentional governed exceptions and native governance files receive the same governing decision rather than conflicting because one validator ignored the unified configuration source.

A validation failure keeps assimilation in \`repairing\` or \`blocked\` state. It must never be reported as complete merely because the outer Crucible gate passed earlier in the run.

## Injection lifetime

Temporary injection and assimilation authority remains one-time and self-expiring under the authorized injection window. The monitoring link has a hard maximum lifetime of 24 hours and is disabled immediately when assimilation completes, is cancelled, becomes blocked beyond authority, or expires. It never becomes a persistent project monitor.

Expiration severs only the temporary injection/monitoring authority. Governance already assimilated into the receiving project's unified native governing body remains in force until changed through the receiving project's normal authorized governance process.

Any later injection, replacement, or expansion of injection authority requires fresh authorization and a fresh temporary monitoring link.
`;

function action(id, label, description, command, extra = {}) {
  return { id, label, description, command, ...extra };
}

function autoInjectFiles() {
  return [
    {
      path: '.nexus/crucible-auto-inject.json',
      content: JSON.stringify({
        schemaVersion: 1,
        pluginId: 'the-crucible',
        pluginVersion: VERSION,
        mode: 'selected-auto-inject',
        source: 'Nexus plugin',
        injectedGovernance: [
          'governingDocuments/agent-progress-policy.md',
          'governingDocuments/templates/injection-chain-of-command.md'
        ]
      }, null, 2) + '\n'
    },
    { path: 'governingDocuments/agent-progress-policy.md', content: AGENT_PROGRESS_POLICY },
    { path: 'governingDocuments/templates/injection-chain-of-command.md', content: INJECTION_CHAIN_OF_COMMAND }
  ];
}

async function runAutoInject(payload = {}) {
  if (payload.selected !== true && payload.confirmed !== true) {
    return {
      ok: false,
      requiresSelection: true,
      actionId: 'crucible-auto-inject',
      message: 'Auto Inject is opt-in. Select or confirm the Auto Inject action before any project files are written.'
    };
  }
  const result = await nexus.call('workspace:write', {
    overwrite: payload.overwrite === true,
    files: autoInjectFiles()
  });
  nexus.emitTelemetry('crucible.plugin.auto-injected', { version: VERSION, fileCount: result.written?.length || 0 });
  return {
    ...result,
    actionId: 'crucible-auto-inject',
    selected: true,
    message: 'Crucible governance bootstrap injected into the active project.'
  };
}

register({
  onActivate() {
    nexus.emitTelemetry('crucible.plugin.activated', { version: VERSION });
  },

  onDeactivate() {
    nexus.emitTelemetry('crucible.plugin.deactivated', { version: VERSION });
  },

  slots: {
    'project-actions': async (payload = {}) => {
      if (payload.actionId === 'crucible-auto-inject') return runAutoInject(payload);
      return {
        plugin: PLUGIN_NAME,
        version: VERSION,
        projectRoot: payload.projectRoot || null,
        actions: [
          action(
            'crucible-auto-inject',
            'Auto Inject The Crucible',
            'Explicitly inject the bundled Crucible governance bootstrap into this project. This is OFF unless selected.',
            null,
            { selectable: true, selectedByDefault: false, requiresConfirmation: true, capability: 'workspace:write' }
          ),
          action(
            'crucible-validate',
            'Validate with The Crucible',
            'Run the project through its configured Crucible validation and governance checks.',
            'npx the-crucible validate'
          ),
          action(
            'crucible-release-gate',
            'Run Crucible release gate',
            'Run the project release/stress gate before promotion or publication.',
            'npm run release:crucible'
          )
        ],
        note: 'Auto Inject requires explicit selection. Merely installing or enabling this plug-in does not modify the project.'
      };
    },

    'inspector-panel': async (payload = {}) => ({
      title: 'The Crucible',
      status: 'available',
      projectRoot: payload.projectRoot || null,
      autoInject: {
        available: true,
        selectedByDefault: false,
        actionId: 'crucible-auto-inject',
        writes: [
          '.nexus/crucible-auto-inject.json',
          'governingDocuments/agent-progress-policy.md',
          'governingDocuments/templates/injection-chain-of-command.md'
        ]
      },
      checks: [
        { id: 'configuration', label: '.thecrucible.json', expected: 'project configuration when a full Crucible integration is configured' },
        { id: 'governance', label: 'governingDocuments/', expected: 'governance baseline when Auto Inject is selected' },
        { id: 'workflow', label: '.github/workflows/the-crucible.yml', expected: 'CI enforcement workflow when separately configured' }
      ],
      safety: 'Auto Inject is opt-in and writes only project-local files through Nexus workspace:write. Existing files are not overwritten unless overwrite is explicitly requested.'
    }),

    'command-palette': async () => ({
      commands: [
        action('crucible.autoInject', 'Crucible: Auto Inject (select first)', 'Inject the bundled Crucible governance bootstrap after explicit selection.', null, { actionId: 'crucible-auto-inject', selectable: true, selectedByDefault: false }),
        action('crucible.validate', 'Crucible: Validate project', 'Validate the active project with The Crucible.', 'npx the-crucible validate'),
        action('crucible.release', 'Crucible: Run release gate', 'Run the configured Crucible release gate.', 'npm run release:crucible'),
        action('crucible.inspect', 'Crucible: Inspect governance', 'Open the Crucible inspector panel.', null)
      ]
    })
  }
});
