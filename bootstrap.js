// Nexus bootstrap: registers narrowly scoped upgrade IPC before loading the legacy main process.
const fs = require('fs');
const path = require('path');
const { app, ipcMain, webContents, dialog } = require('electron');
const { registerSection7Ipc } = require('./section7Ipc');
const { registerSection8Ipc } = require('./section8Ipc');
const { listProjects } = require('./projectRegistry');
const { createSenderValidator, secureIpcHandlers } = require('./ipcSecurity');

const assertTrustedSender = createSenderValidator(__dirname);
secureIpcHandlers(ipcMain, assertTrustedSender);

function canonicalProjectPath(value) {
  try {
    const resolved = fs.realpathSync(path.resolve(value));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  } catch {
    return null;
  }
}

function isAuthorizedProjectRoot(projectRoot) {
  const candidate = canonicalProjectPath(projectRoot);
  if (!candidate) return false;
  return listProjects().some((project) => canonicalProjectPath(project.localPath) === candidate);
}

// The legacy main process already owns encrypted config persistence. Wrap only
// the coding-provider IPC registrations so the provider card uses that same
// storage instead of behaving like a disconnected second settings system.
function installCodingModelProviderIpcUpgrade() {
  const securedHandle = ipcMain.handle.bind(ipcMain);
  const handlers = new Map();
  const watchedChannels = new Set([
    'save-nim-key',
    'clear-nim-key',
    'coding-models:status',
    'coding-models:save-key',
    'coding-models:clear-key',
    'coding-models:select',
  ]);

  ipcMain.handle = (channel, listener) => {
    if (!watchedChannels.has(channel)) return securedHandle(channel, listener);
    handlers.set(channel, listener);

    if (channel === 'coding-models:save-key') {
      return securedHandle(channel, async (event, payload = {}) => {
        const id = String(payload.id || '');
        const saveHandler = id === 'nim' ? handlers.get('save-nim-key') : listener;
        if (!saveHandler) return { ok:false, error:'Coding provider key storage is not ready.' };
        const saved = await saveHandler(event, id === 'nim' ? { key:payload.key } : payload);
        if (!saved?.ok) return saved;

        const selectHandler = handlers.get('coding-models:select');
        if (!selectHandler) return { ok:true, activated:false, error:'Key saved, but provider activation is not ready.' };
        const selected = await selectHandler(event, { id });
        if (!selected?.ok) return { ok:true, activated:false, error:`Key saved, but activation failed: ${selected.error || 'unknown error'}` };
        return { ok:true, activated:true };
      });
    }

    if (channel === 'coding-models:clear-key') {
      return securedHandle(channel, async (event, payload = {}) => {
        const id = String(payload.id || '');
        const clearHandler = id === 'nim' ? handlers.get('clear-nim-key') : listener;
        if (!clearHandler) return { ok:false, error:'Coding provider key storage is not ready.' };
        return clearHandler(event, id === 'nim' ? {} : payload);
      });
    }

    if (channel === 'coding-models:status') {
      return securedHandle(channel, async (event, ...args) => {
        const result = await listener(event, ...args);
        if (!result?.ok || !Array.isArray(result.providers)) return result;
        result.providers = result.providers.filter((item) => item.id !== 'glm');
        if (!result.providers.some((item) => item.id === result.selected)) {
          result.selected = result.providers.find((item) => item.configured)?.id || 'nim';
        }
        return result;
      });
    }

    return securedHandle(channel, listener);
  };

  return () => { ipcMain.handle = securedHandle; };
}

// Keep the existing renderer intact, but normalize the provider card after it
// loads: NVIDIA uses the same key field as every other hosted coding provider,
// and the retired GLM/Z.ai choice is removed from the UI.
function installCodingModelProviderUiUpgrade() {
  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', () => {
      window.webContents.executeJavaScript(`(() => {
        const select = document.getElementById('coding-model-provider');
        const key = document.getElementById('coding-model-key');
        const status = document.getElementById('coding-model-status');
        if (!select || !key) return;

        const normalize = () => {
          select.querySelector('option[value="glm"]')?.remove();
          const id = select.value;
          const local = id === 'ollama' || id === 'lmstudio';
          key.disabled = local;
          key.placeholder = local
            ? 'No API key required'
            : 'API key for ' + (select.selectedOptions[0]?.textContent?.trim() || 'selected provider');
        };

        select.addEventListener('change', () => setTimeout(normalize, 0));
        if (status) new MutationObserver(normalize).observe(status, { childList:true, characterData:true, subtree:true });
        normalize();
      })();`).catch((error) => console.error('[Nexus] Coding provider UI upgrade failed:', error.message));
    });
  });
}

registerSection7Ipc({ ipcMain, webContents, authorizeRuntime: (folder) => isAuthorizedProjectRoot(folder) && Boolean(global.nexusAuthorizeRuntime?.(folder)) });
registerSection8Ipc({
  ipcMain,
  isAuthorizedProjectRoot,
  selectPluginFolder: async () => {
    const selection = await dialog.showOpenDialog({ title: 'Choose a Nexus plug-in folder to screen', properties: ['openDirectory', 'dontAddToRecent'] });
    return selection.canceled ? null : selection.filePaths[0];
  },
});
global.nexusAssertTrustedIpcSender = assertTrustedSender;

installCodingModelProviderUiUpgrade();
const restoreIpcHandle = installCodingModelProviderIpcUpgrade();
require('./main.js');
restoreIpcHandle();
