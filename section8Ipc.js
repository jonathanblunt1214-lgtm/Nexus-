const path = require('path');
const fs = require('fs');
const { PluginManager } = require('./pluginManager');
const { createPluginCapabilityHandlers } = require('./pluginCapabilities');
const { CrucibleLearningIdentity } = require('./crucibleLearningIdentity');

function normalizeProjectRoot(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('projectRoot is required');
  const root = path.resolve(value);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('projectRoot must be an existing directory');
  return fs.realpathSync(root);
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

  return { managers, identities, provisioned, getManager };
}

module.exports = { registerSection8Ipc, normalizeProjectRoot };
