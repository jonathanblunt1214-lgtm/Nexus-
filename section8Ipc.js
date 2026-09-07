const path = require('path');
const fs = require('fs');
const { PluginManager } = require('./pluginManager');
const { createPluginCapabilityHandlers } = require('./pluginCapabilities');
const { CrucibleLearningIdentity } = require('./crucibleLearningIdentity');

const CODING_DELEGATION_CHANNELS = new Set([
  'coding-models:ask',
  'ai-edit-file-with-prompt',
  'ai-propose-fix',
  'diagnostics:explain-and-learn',
  'ai-suggest-features',
  'ai-plan-feature',
  'ai-propose-feature-file',
  'run-feature-plan-autonomous',
  'ai-generate-changelog',
]);

function normalizeProjectRoot(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('projectRoot is required');
  const root = path.resolve(value);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('projectRoot must be an existing directory');
  return fs.realpathSync(root);
}

function canonicalPath(value) {
  try {
    const resolved = fs.realpathSync(path.resolve(value));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  } catch {
    return null;
  }
}

function projectRootFromPayload(payload = {}, listProjectsFactory = null) {
  const direct = payload.folder || payload.projectRoot;
  if (direct) {
    const candidate = canonicalPath(direct);
    if (candidate) return candidate;
  }
  const filePath = payload.filePath;
  if (!filePath) return null;
  const listProjects = listProjectsFactory || (() => require('./projectRegistry').listProjects());
  const candidateFile = path.resolve(filePath);
  const comparableFile = process.platform === 'win32' ? candidateFile.toLowerCase() : candidateFile;
  for (const project of listProjects()) {
    const root = canonicalPath(project.localPath);
    if (!root) continue;
    if (comparableFile === root || comparableFile.startsWith(`${root}${path.sep}`)) return root;
  }
  return null;
}

function isAiCollaborationRecord(record) {
  const id = String(record?.id || '').toLowerCase().replace(/[_\s]+/g, '-');
  const name = String(record?.name || '').trim().toLowerCase();
  return name === 'ai collaboration' || id === 'ai-collaboration' || id.includes('ai-collaboration');
}

function registerSection8Ipc({ ipcMain, managerFactory, identityProviderFactory, isAuthorizedProjectRoot, selectPluginFolder } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('ipcMain.handle is required');
  if (typeof isAuthorizedProjectRoot !== 'function') throw new Error('isAuthorizedProjectRoot is required');
  const managers = new Map();
  const identities = new Map();
  const provisioned = new Set();
  const identityFor = (projectRoot) => {
    if (!identities.has(projectRoot)) identities.set(projectRoot, identityProviderFactory ? identityProviderFactory(projectRoot) : new CrucibleLearningIdentity(projectRoot));
    return identities.get(projectRoot);
  };
  const makeManager = managerFactory || ((projectRoot) => {
    const identity = identityFor(projectRoot);
    return new PluginManager({
      projectRoot,
      requireSigned: true,
      capabilityHandlers: createPluginCapabilityHandlers(projectRoot),
      slotPayloadDecorator: (pluginId, slot, payload) => identity.decorate(pluginId, slot, payload),
    });
  });

  function getManager(projectRoot) {
    const root = normalizeProjectRoot(projectRoot);
    if (!isAuthorizedProjectRoot(root)) throw new Error('Plugin access denied: projectRoot is not an authorized Nexus workspace');
    if (!managers.has(root)) managers.set(root, makeManager(root));
    return managers.get(root);
  }

  async function ensureDiscovered(manager) {
    if (!manager.registry || manager.registry.size === 0) manager.discover();
    return manager.list();
  }

  async function ensureActive(manager, record) {
    if (!record) return null;
    if (record.status === 'ACTIVE') return record;
    if (record.status !== 'DISCOVERED') return null;
    return manager.enable(record.id);
  }

  async function invokeOne(manager, pluginId, slot, payload) {
    const record = manager.registry?.get(pluginId);
    if (!record?.manifest?.slots?.includes(slot)) throw new Error(`${record?.manifest?.name || pluginId} does not provide the ${slot} API.`);
    const decorated = manager.slotPayloadDecorator ? await manager.slotPayloadDecorator(pluginId, slot, payload) : payload;
    return manager.runtime.invokeSlot(pluginId, slot, decorated, (code, metadata) => manager.audit(pluginId, code, metadata));
  }

  async function crucibleCodingContext(manager) {
    const records = await ensureDiscovered(manager);
    const listed = records.find((item) => item.id === 'the-crucible');
    const crucible = await ensureActive(manager, listed);
    if (!crucible) return null;
    const context = {
      pluginId: 'the-crucible',
      governance: null,
      branchLinks: null,
      verifiedKnowledge: null,
    };
    try {
      context.governance = await invokeOne(manager, 'the-crucible', 'project-actions', { actionId: 'crucible-governance-list' });
    } catch (error) {
      context.governance = { ok: false, error: error.message };
    }
    try {
      context.branchLinks = await invokeOne(manager, 'the-crucible', 'project-actions', { actionId: 'crucible-branch-links-read' });
    } catch (error) {
      context.branchLinks = { ok: false, error: error.message };
    }
    try {
      const readiness = await invokeOne(manager, 'the-crucible', 'project-actions', { actionId: 'crucible-learning-readiness' });
      if (readiness?.ready) {
        context.verifiedKnowledge = await invokeOne(manager, 'the-crucible', 'project-actions', { actionId: 'crucible-learning-retrieve' });
      } else {
        context.verifiedKnowledge = { ok: false, ready: false };
      }
    } catch (error) {
      context.verifiedKnowledge = { ok: false, error: error.message };
    }
    return context;
  }

  async function delegateCoding(projectRoot, channel, payload) {
    if (!projectRoot || !isAuthorizedProjectRoot(projectRoot)) return { delegated: false };
    const manager = getManager(projectRoot);
    const records = await ensureDiscovered(manager);
    const collaborationRecord = records.find(isAiCollaborationRecord);
    if (!collaborationRecord) return { delegated: false };
    const collaboration = await ensureActive(manager, collaborationRecord);
    if (!collaboration) return { delegated: false };
    const manifest = manager.registry?.get(collaboration.id)?.manifest;
    if (!manifest?.slots?.includes('coding-provider')) return { delegated: false };
    const crucible = await crucibleCodingContext(manager);
    try {
      const value = await invokeOne(manager, collaboration.id, 'coding-provider', {
        channel,
        request: payload,
        collaborationContext: crucible ? { crucible } : {},
      });
      return { delegated: true, value, pluginId: collaboration.id };
    } catch (error) {
      throw new Error(`AI Collaboration coding API failed: ${error.message}`);
    }
  }

  async function runCrucibleSaveHook(projectRoot, payload = {}) {
    if (!projectRoot || !isAuthorizedProjectRoot(projectRoot)) return { invoked: false };
    const manager = getManager(projectRoot);
    const records = await ensureDiscovered(manager);
    const crucibleRecord = records.find((item) => item.id === 'the-crucible');
    const crucible = await ensureActive(manager, crucibleRecord);
    if (!crucible) return { invoked: false };
    try {
      const preview = await invokeOne(manager, 'the-crucible', 'project-actions', { actionId: 'crucible-auto-inject-preview' });
      const pending = Array.isArray(preview?.writes) ? preview.writes.some((item) => item.exists !== true) : true;
      if (!pending) return { invoked: true, injected: false, alreadyPresent: true };
      const value = await invokeOne(manager, 'the-crucible', 'project-actions', {
        actionId: 'crucible-auto-inject',
        selected: true,
        confirmed: true,
        overwrite: false,
        trigger: 'project-save',
        savedFile: payload.filePath || null,
      });
      return { invoked: true, injected: Boolean(value?.ok), value };
    } catch (error) {
      throw new Error(`The Crucible project-save injection failed: ${error.message}`);
    }
  }

  ipcMain.handle('plugins:scan', async (_event, { projectRoot } = {}) => getManager(projectRoot).discover());
  ipcMain.handle('plugins:import', async (_event, { projectRoot } = {}) => {
    if (typeof selectPluginFolder !== 'function') throw new Error('Plug-in folder selection is unavailable.');
    const sourceFolder = await selectPluginFolder();
    if (!sourceFolder) return { ok: false, canceled: true };
    return getManager(projectRoot).importFromFolder(sourceFolder);
  });
  ipcMain.handle('plugins:marketplace-list', async () => {
    if (!global.nexusPluginMarketplaceApi) throw new Error('Plug-in marketplace is unavailable.');
    return global.nexusPluginMarketplaceApi.list();
  });
  ipcMain.handle('plugins:marketplace-publish', async (_event, { projectRoot, pluginId, visibility } = {}) => {
    if (typeof pluginId !== 'string' || !pluginId) throw new Error('pluginId is required');
    return global.nexusPluginMarketplaceApi.publish(getManager(projectRoot), pluginId, visibility);
  });
  ipcMain.handle('plugins:marketplace-install', async (_event, { projectRoot, marketplaceId } = {}) => {
    if (typeof marketplaceId !== 'string' || !/^[a-f0-9]{64}$/.test(marketplaceId)) throw new Error('marketplaceId is invalid');
    return global.nexusPluginMarketplaceApi.install(getManager(projectRoot), marketplaceId);
  });
  ipcMain.handle('plugins:list', async (_event, { projectRoot } = {}) => getManager(projectRoot).list());
  ipcMain.handle('plugins:enable', async (_event, { projectRoot, pluginId } = {}) => {
    if (typeof pluginId !== 'string' || !pluginId) throw new Error('pluginId is required');
    return getManager(projectRoot).enable(pluginId);
  });
  ipcMain.handle('plugins:disable', async (_event, { projectRoot, pluginId } = {}) => {
    if (typeof pluginId !== 'string' || !pluginId) throw new Error('pluginId is required');
    return getManager(projectRoot).disable(pluginId);
  });
  ipcMain.handle('plugins:slots', async (_event, { projectRoot } = {}) => getManager(projectRoot).listSlots());
  ipcMain.handle('plugins:health', async (_event, { projectRoot } = {}) => getManager(projectRoot).health());
  ipcMain.handle('plugins:invoke-slot', async (_event, { projectRoot, slot, payload } = {}) => {
    if (typeof slot !== 'string' || !slot) throw new Error('slot is required');
    return getManager(projectRoot).invokeSlot(slot, payload || {});
  });
  ipcMain.handle('plugins:crucible-provision', async (_event, { projectRoot } = {}) => {
    const manager = getManager(projectRoot);
    const root = normalizeProjectRoot(projectRoot);
    const identity = identityFor(root);
    if (!provisioned.has(root)) {
      manager.discover();
      const existing = manager.list().find((item) => item.id === 'the-crucible');
      if (existing?.status === 'ACTIVE') await manager.disable('the-crucible');
      manager.installBundledFromFolder(path.join(__dirname, 'plugins', 'the-crucible'));
      await manager.enable('the-crucible');
      provisioned.add(root);
    }
    const read = async (actionId) => {
      const result = await manager.invokeSlot('project-actions', { actionId });
      const crucible = result.find((item) => item.pluginId === 'the-crucible');
      if (!crucible?.ok) throw new Error(crucible?.error || 'The Crucible plugin did not respond.');
      return crucible.value;
    };
    let readiness = await read('crucible-learning-readiness');
    if (!readiness.ready) await read('crucible-learning-configure');
    readiness = await read('crucible-learning-readiness');
    if (!readiness.ready) throw new Error('The Crucible secure-learning readiness gate did not become ready.');
    return { ok: true, ready: true, plugin: manager.list().find((item) => item.id === 'the-crucible'), identity: identity.publicStatus(), readiness };
  });

  const registerMainHandler = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    if (CODING_DELEGATION_CHANNELS.has(channel)) {
      return registerMainHandler(channel, async (event, payload = {}) => {
        const projectRoot = projectRootFromPayload(payload);
        const delegated = await delegateCoding(projectRoot, channel, payload);
        if (delegated.delegated) return delegated.value;
        return listener(event, payload);
      });
    }
    if (channel === 'apply-file-change') {
      return registerMainHandler(channel, async (event, payload = {}) => {
        const result = await listener(event, payload);
        if (result?.ok === false) return result;
        const projectRoot = projectRootFromPayload(payload);
        await runCrucibleSaveHook(projectRoot, payload);
        return result;
      });
    }
    return registerMainHandler(channel, listener);
  };

  return { managers, identities, provisioned, getManager, delegateCoding, runCrucibleSaveHook };
}

module.exports = { registerSection8Ipc, normalizeProjectRoot, projectRootFromPayload, isAiCollaborationRecord, CODING_DELEGATION_CHANNELS };
