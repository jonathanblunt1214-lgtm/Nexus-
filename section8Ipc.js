const path = require('path');
const fs = require('fs');
const { PluginManager } = require('./pluginManager');

function normalizeProjectRoot(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('projectRoot is required');
  const root = path.resolve(value);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('projectRoot must be an existing directory');
  return root;
}

function registerSection8Ipc({ ipcMain, managerFactory } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('ipcMain.handle is required');
  const managers = new Map();
  const makeManager = managerFactory || ((projectRoot) => new PluginManager({ projectRoot, requireSigned: true }));

  function getManager(projectRoot) {
    const root = normalizeProjectRoot(projectRoot);
    if (!managers.has(root)) managers.set(root, makeManager(root));
    return managers.get(root);
  }

  ipcMain.handle('plugins:scan', async (_event, { projectRoot } = {}) => getManager(projectRoot).discover());
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

  return { managers, getManager };
}

module.exports = { registerSection8Ipc, normalizeProjectRoot };
