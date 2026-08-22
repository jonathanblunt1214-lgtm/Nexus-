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

  // Keep config disk I/O off the Electron main thread. Remove the earlier
  // synchronous helper import if a prior remediation run installed it.
  source = source.replace("const { writeJsonAtomicSync } = require('./atomicWrite');\n", '');
  if (!source.includes("const { writeJsonAtomic } = require('./atomicWrite');")) {
    const anchor = "const fs = require('fs');";
    if (!source.includes(anchor)) throw new Error('Could not locate fs import in main.js');
    source = source.replace(anchor, `${anchor}\nconst { writeJsonAtomic } = require('./atomicWrite');`);
  }

  const sectionStart = source.indexOf('// Where we persist small bits of config');
  const sectionEnd = source.indexOf('// ---- Terminal state', sectionStart);
  if (sectionStart === -1 || sectionEnd === -1) throw new Error('Could not locate main.js config persistence section');

  const configSection = `// Where we persist small bits of config (encrypted provider keys, project secrets, GCP project id).\n// Disk I/O is asynchronous and writes are crash-safe: callers only see an initialized\n// in-memory snapshot, while replacements go through temp-file + atomic rename.\nconst CONFIG_PATH = path.join(app.getPath('userData'), 'nexus-config.json');\nlet configCache = {};\nlet configWriteQueue = Promise.resolve();\n\nasync function initializeConfig() {\n  try {\n    configCache = JSON.parse(await fs.promises.readFile(CONFIG_PATH, 'utf8'));\n  } catch (err) {\n    if (err?.code !== 'ENOENT') {\n      console.error('[Nexus] Could not read nexus-config.json:', err.message);\n    }\n    configCache = {};\n  }\n}\n\nfunction loadConfig() {\n  return JSON.parse(JSON.stringify(configCache));\n}\n\nfunction saveConfig(cfg) {\n  configCache = JSON.parse(JSON.stringify(cfg || {}));\n  const snapshot = JSON.parse(JSON.stringify(configCache));\n  configWriteQueue = configWriteQueue\n    .catch(() => undefined)\n    .then(() => writeJsonAtomic(CONFIG_PATH, snapshot));\n  return configWriteQueue;\n}\n\n`;
  source = source.slice(0, sectionStart) + configSection + source.slice(sectionEnd);

  if (!source.includes('await initializeConfig();')) {
    const readyMarker = `app.whenReady().then(async () => {\n  createWindow();`;
    if (!source.includes(readyMarker)) throw new Error('Could not locate app.whenReady initialization');
    source = source.replace(readyMarker, `app.whenReady().then(async () => {\n  await initializeConfig();\n  createWindow();`);
  }

  const configMutationChannels = [
    'save-gemini-key', 'clear-gemini-key', 'save-openai-key', 'clear-openai-key',
    'save-gcp-project', 'save-nim-key', 'clear-nim-key', 'save-project-secret',
    'delete-project-secret', 'save-github-token', 'clear-github-token',
  ];
  for (const channel of configMutationChannels) {
    const syncMarker = `ipcMain.handle('${channel}', (`;
    const asyncMarker = `ipcMain.handle('${channel}', async (`;
    if (source.includes(syncMarker)) source = source.replace(syncMarker, asyncMarker);
    if (!source.includes(asyncMarker)) throw new Error(`Could not make ${channel} await durable config persistence`);
  }

  source = source
    .split('\n')
    .map((line) => {
      if (line.includes('saveConfig(cfg);') && !line.includes('await saveConfig(cfg);')) {
        return line.replace('saveConfig(cfg);', 'await saveConfig(cfg);');
      }
      return line;
    })
    .join('\n');

  if (/readFileSync\(CONFIG_PATH|writeFileSync\(CONFIG_PATH|writeJsonAtomicSync\(CONFIG_PATH/.test(source)) {
    throw new Error('Synchronous nexus-config.json persistence remains in main.js');
  }
  if (!/await fs\.promises\.readFile\(CONFIG_PATH/.test(source) || !/writeJsonAtomic\(CONFIG_PATH/.test(source)) {
    throw new Error('Asynchronous atomic nexus-config.json persistence patch did not apply');
  }

  write(file, source);
}

patchPreload();
patchMainPersistence();
console.log('[PASS] Applied Section 8 preload bridge and asynchronous atomic config persistence patches.');
