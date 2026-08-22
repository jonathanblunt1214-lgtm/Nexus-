const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFileSync(path.join(root, file), content, 'utf8');

function patchPreload() {
  const file = 'preload.js';
  let source = read(file);
  if (source.includes('pluginsScan:')) return;
  const marker = '  // Section 7: local-preview vision and isolated runtime debugging only.';
  if (!source.includes(marker)) throw new Error('Could not locate Section 7 preload marker');
  const bridge = `  // Section 8: signed plugin platform. Project-root authorization is rechecked\n  // in the main process; the renderer receives only narrow lifecycle calls.\n  pluginsScan: (projectRoot) => ipcRenderer.invoke('plugins:scan', { projectRoot }),\n  pluginsList: (projectRoot) => ipcRenderer.invoke('plugins:list', { projectRoot }),\n  pluginsEnable: (projectRoot, pluginId) => ipcRenderer.invoke('plugins:enable', { projectRoot, pluginId }),\n  pluginsDisable: (projectRoot, pluginId) => ipcRenderer.invoke('plugins:disable', { projectRoot, pluginId }),\n  pluginsSlots: (projectRoot) => ipcRenderer.invoke('plugins:slots', { projectRoot }),\n  pluginsHealth: (projectRoot) => ipcRenderer.invoke('plugins:health', { projectRoot }),\n  pluginsInvokeSlot: (projectRoot, slot, payload) => ipcRenderer.invoke('plugins:invoke-slot', { projectRoot, slot, payload }),\n\n`;
  source = source.replace(marker, bridge + marker);
  write(file, source);
}

function patchMainPersistence() {
  const file = 'main.js';
  let source = read(file);
  if (!source.includes("require('./atomicWrite')")) {
    const anchor = "const fs = require('fs');";
    if (!source.includes(anchor)) throw new Error('Could not locate fs import in main.js');
    source = source.replace(anchor, `${anchor}\nconst { writeJsonAtomicSync } = require('./atomicWrite');`);
  }
  const oldBody = "function saveConfig(cfg) {\n  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');\n}";
  const newBody = "function saveConfig(cfg) {\n  writeJsonAtomicSync(CONFIG_PATH, cfg);\n}";
  if (source.includes(oldBody)) source = source.replace(oldBody, newBody);
  if (!/function saveConfig\(cfg\) \{\s*writeJsonAtomicSync\(CONFIG_PATH, cfg\);\s*\}/.test(source)) {
    throw new Error('main.js saveConfig atomic persistence patch did not apply');
  }
  write(file, source);
}

patchPreload();
patchMainPersistence();
console.log('[PASS] Applied preload Section 8 bridge and atomic config persistence patches.');
