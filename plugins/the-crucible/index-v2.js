const PLUGIN_NAME = 'The Crucible';
const VERSION = '1.2.0';
const GOVERNANCE_ROOT = 'governingDocuments';

function action(id, label, description, extra = {}) {
  return { id, label, description, ...extra };
}

function isGovernancePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized === GOVERNANCE_ROOT || normalized.startsWith(`${GOVERNANCE_ROOT}/`);
}

function bootstrapFiles() {
  return [
    {
      path: 'governingDocuments/README.md',
      content: '# The Crucible governance\n\nThis governance tree is managed by The Crucible plugin through Nexus. Every file under `governingDocuments/` can be opened and edited from the plugin configuration menu. Changes are project files and remain subject to the receiving project\'s normal review, validation, and branch rules.\n',
    },
    {
      path: 'governingDocuments/crucible-plugin-governance.md',
      content: '# Crucible plugin governance\n\n- Auto Inject is opt-in and never runs merely because the plugin is installed or enabled.\n- Governance editing is scoped to `governingDocuments/`.\n- Existing files are not overwritten by Auto Inject unless overwrite is separately authorized.\n- Injection-history records are account-private and are not written into the project.\n- Project governance contents themselves remain normal project files so project-native governance can enforce them.\n',
    },
  ];
}

async function listGovernance() {
  const result = await nexus.call('workspace:read', { operation: 'list', path: GOVERNANCE_ROOT });
  return { ok: true, files: (result.files || []).filter(isGovernancePath) };
}

async function readGovernance(path) {
  if (!isGovernancePath(path) || String(path).replace(/\\/g, '/') === GOVERNANCE_ROOT) throw new Error('Choose a file inside governingDocuments/.');
  return nexus.call('workspace:read', { operation: 'read', path });
}

async function saveGovernance(path, content) {
  if (!isGovernancePath(path) || String(path).replace(/\\/g, '/') === GOVERNANCE_ROOT) throw new Error('Governance edits must target a file inside governingDocuments/.');
  if (typeof content !== 'string') throw new Error('Governance file content must be text.');
  const result = await nexus.call('workspace:write', { overwrite: true, files: [{ path, content }] });
  nexus.emitTelemetry('crucible.governance.saved', { version: VERSION, path });
  return { ok: true, ...result, path };
}

async function privateTracking(payload) {
  return nexus.call('account:private', payload);
}

async function runAutoInject(payload = {}) {
  if (payload.selected !== true || payload.confirmed !== true) {
    return { ok: false, requiresSelection: true, message: 'Auto Inject requires explicit selection and confirmation.' };
  }
  const projectRoot = payload.projectRoot;
  if (!projectRoot) throw new Error('projectRoot is required for Auto Inject.');
  const result = await nexus.call('workspace:write', {
    overwrite: payload.overwrite === true,
    files: bootstrapFiles(),
  });
  let tracking = null;
  try {
    tracking = await privateTracking({
      operation: 'record',
      projectRoot,
      pluginVersion: VERSION,
      action: 'auto-inject',
      files: result.written || [],
    });
  } catch (error) {
    tracking = { ok: false, private: true, error: error.message };
  }
  nexus.emitTelemetry('crucible.plugin.auto-injected', { version: VERSION, fileCount: result.written?.length || 0, privateTrackingRecorded: tracking?.ok === true });
  return {
    ok: true,
    ...result,
    tracking,
    message: tracking?.ok
      ? 'Crucible governance was injected and its file list was recorded privately in this Nexus account.'
      : 'Crucible governance was injected. Private account tracking could not be recorded; sign in to Nexus to enable private tracking.',
  };
}

async function projectAction(payload = {}) {
  switch (payload.actionId) {
    case 'crucible-auto-inject': return runAutoInject(payload);
    case 'crucible-governance-list': return listGovernance();
    case 'crucible-governance-read': return readGovernance(payload.path);
    case 'crucible-governance-save': return saveGovernance(payload.path, payload.content);
    case 'crucible-tracking-list': return privateTracking({ operation: 'list', projectRoot: payload.projectRoot });
    case 'crucible-tracking-status': return privateTracking({ operation: 'status' });
    default:
      return {
        plugin: PLUGIN_NAME,
        version: VERSION,
        actions: [
          action('crucible-auto-inject', 'Auto Inject The Crucible', 'Inject the Crucible governance bootstrap only after explicit selection.', { selectable: true, selectedByDefault: false, requiresConfirmation: true }),
          action('crucible-configure-governance', 'Configure Crucible governance', 'Open the Nexus governance editor for every file under governingDocuments/.', { opensConfiguration: true }),
          action('crucible-private-tracking', 'View my injection history', 'View injection records visible only to the currently signed-in Nexus account.', { accountPrivate: true }),
        ],
      };
  }
}

register({
  onActivate() { nexus.emitTelemetry('crucible.plugin.activated', { version: VERSION }); },
  onDeactivate() { nexus.emitTelemetry('crucible.plugin.deactivated', { version: VERSION }); },
  slots: {
    'project-actions': projectAction,
    'inspector-panel': async (payload = {}) => {
      const files = await listGovernance().catch(() => ({ files: [] }));
      return {
        title: 'The Crucible governance',
        version: VERSION,
        projectRoot: payload.projectRoot || null,
        governanceRoot: GOVERNANCE_ROOT,
        configurable: true,
        files: files.files,
        trackingVisibility: 'current signed-in Nexus account only',
        autoInjectSelectedByDefault: false,
      };
    },
    'command-palette': async () => ({
      commands: [
        action('crucible.configure', 'Crucible: Configure governance', 'Open the Crucible governance configuration menu.', { opensConfiguration: true }),
        action('crucible.autoInject', 'Crucible: Auto Inject', 'Inject after explicit selection and confirmation.', { actionId: 'crucible-auto-inject', selectable: true, selectedByDefault: false }),
        action('crucible.tracking', 'Crucible: My injection history', 'View account-private Crucible injection tracking.', { accountPrivate: true }),
      ],
    }),
  },
});
