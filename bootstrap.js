// Nexus bootstrap: registers narrowly scoped upgrade IPC before loading the legacy main process.
const fs = require('fs');
const path = require('path');
const { app, ipcMain, webContents, dialog } = require('electron');
const { registerSection7Ipc } = require('./section7Ipc');
const { registerSection8Ipc } = require('./section8Ipc');
const { listProjects } = require('./projectRegistry');
const publisherConfig = require('./publisherConfig');
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

async function askWithNexusGemini(prompt) {
  const key = String(process.env.NEXUS_GEMINI_API_KEY || '').trim();
  if (!key) return { ok:false, error:'Nexus Gemini is not configured in this build.' };
  const model = 'gemini-1.5-flash';
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ contents:[{ parts:[{ text:String(prompt || '') }] }] }),
    });
    const data = await response.json();
    if (!response.ok) return { ok:false, error:data?.error?.message || `Gemini HTTP ${response.status}` };
    const text = (data?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || '').join('');
    return { ok:true, text:text || '(empty response)' };
  } catch (error) {
    return { ok:false, error:error.message };
  }
}

// The legacy main process already owns encrypted provider persistence. Wrap
// only the coding-provider and project-owned service channels that remain
// part of Nexus's supported Settings/runtime surface.
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
    'save-gcp-project',
    'get-gcp-project',
    'gemini-ask',
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

    if (channel === 'get-gcp-project') {
      return securedHandle(channel, () => publisherConfig.firebaseProjectId || '');
    }
    if (channel === 'save-gcp-project') {
      return securedHandle(channel, () => ({ ok:false, error:'The Nexus Firebase project is application-owned. Configure Firebase per project instead of changing Nexus Settings.' }));
    }

    // Ask Gemini remains an internal Nexus service. It never consumes a
    // user-entered/saved Gemini key; the build injects NEXUS_GEMINI_API_KEY.
    if (channel === 'gemini-ask') {
      return securedHandle(channel, async (_event, payload = {}) => askWithNexusGemini(payload.prompt));
    }

    return securedHandle(channel, listener);
  };

  return () => { ipcMain.handle = securedHandle; };
}

function installCodingModelProviderUiUpgrade() {
  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', () => {
      window.webContents.executeJavaScript(`(() => {
        const select = document.getElementById('coding-model-provider');
        const key = document.getElementById('coding-model-key');
        const status = document.getElementById('coding-model-status');

        const normalizeProviderCard = () => {
          if (!select || !key) return;
          select.querySelector('option[value="glm"]')?.remove();
          const id = select.value;
          const local = id === 'ollama' || id === 'lmstudio';
          key.disabled = local;
          key.placeholder = local
            ? 'No API key required'
            : 'API key for ' + (select.selectedOptions[0]?.textContent?.trim() || 'selected provider');
        };

        if (select) select.addEventListener('change', () => setTimeout(normalizeProviderCard, 0));
        if (status) new MutationObserver(normalizeProviderCard).observe(status, { childList:true, characterData:true, subtree:true });
        normalizeProviderCard();

        const cards = Array.from(document.querySelectorAll('.card'));
        const cardByLabelPrefix = (prefix) => cards.find((card) => (card.querySelector('.label')?.textContent || '').trim().startsWith(prefix));
        const removeCard = (prefix) => cardByLabelPrefix(prefix)?.remove();

        // These are no longer Settings concerns. Gemini is application-owned,
        // OpenAI is retired, Firebase is application/project owned, and NIM
        // lives with the other hosted coding providers below.
        removeCard('NVIDIA NIM API Key');
        removeCard('GCP / Firebase Project ID');
        removeCard('Gemini API Key');
        removeCard('Ask Gemini');
        removeCard('OpenAI API Key');
        removeCard('Ask OpenAI');

        const discovery = cardByLabelPrefix('Safe Provider Discovery');
        if (!discovery || discovery.dataset.hostedKeysReady === 'true') return;
        discovery.dataset.hostedKeysReady = 'true';

        discovery.querySelectorAll('button').forEach((button) => {
          if ((button.textContent || '').includes('Z.ai')) button.remove();
        });
        const description = discovery.querySelector('p.muted');
        if (description) description.textContent = 'Add hosted coding-provider keys here, or detect supported environment variables and local Ollama / LM Studio models. Hosted keys are stored through Nexus encrypted provider storage; key values are never shown back in the interface.';

        const results = document.getElementById('provider-discovery-results');
        const hosted = document.createElement('div');
        hosted.id = 'safe-provider-hosted-keys';
        hosted.style.display = 'grid';
        hosted.style.gap = '8px';
        hosted.style.marginTop = '10px';

        const providers = [
          { id:'nim', label:'NVIDIA NIM', placeholder:'NVIDIA NIM API key' },
          { id:'kimi', label:'Kimi', placeholder:'Kimi API key' },
          { id:'deepseek', label:'DeepSeek', placeholder:'DeepSeek API key' },
        ];

        for (const provider of providers) {
          const row = document.createElement('div');
          row.className = 'suggestion-item';
          const title = document.createElement('strong');
          title.textContent = provider.label;
          const controls = document.createElement('div');
          controls.className = 'form-row';
          controls.style.marginTop = '6px';
          const input = document.createElement('input');
          input.type = 'password';
          input.autocomplete = 'off';
          input.placeholder = provider.placeholder;
          input.id = 'safe-provider-key-' + provider.id;
          const save = document.createElement('button');
          save.className = 'btn';
          save.textContent = 'Save & Activate';
          const clear = document.createElement('button');
          clear.className = 'btn btn-secondary';
          clear.textContent = 'Clear';
          const state = document.createElement('span');
          state.className = 'muted small';
          state.id = 'safe-provider-status-' + provider.id;

          save.addEventListener('click', async () => {
            const value = input.value.trim();
            if (!value) { state.textContent = 'Enter a key first.'; return; }
            save.disabled = true;
            state.textContent = 'Saving…';
            try {
              const result = await window.nexus.saveCodingModelKey(provider.id, value);
              if (result?.ok) {
                input.value = '';
                state.textContent = result.activated === false ? (result.error || 'Saved; activation pending.') : 'Saved · ACTIVE';
                if (typeof window.refreshCodingModels === 'function') window.refreshCodingModels();
              } else state.textContent = result?.error || 'Could not save key.';
            } catch (error) {
              state.textContent = error.message;
            } finally {
              save.disabled = false;
            }
          });

          clear.addEventListener('click', async () => {
            clear.disabled = true;
            state.textContent = 'Clearing…';
            try {
              const result = await window.nexus.clearCodingModelKey(provider.id);
              state.textContent = result?.ok ? 'Cleared' : (result?.error || 'Could not clear key.');
              if (result?.ok && typeof window.refreshCodingModels === 'function') window.refreshCodingModels();
            } catch (error) {
              state.textContent = error.message;
            } finally {
              clear.disabled = false;
            }
          });

          controls.append(input, save, clear);
          row.append(title, controls, state);
          hosted.appendChild(row);
        }

        if (results) discovery.insertBefore(hosted, results);
        else discovery.appendChild(hosted);
      })();`).catch((error) => console.error('[Nexus] Settings/provider UI upgrade failed:', error.message));
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

// Permanently retire the user-managed Gemini-key and OpenAI surfaces from the
// active Nexus runtime. The legacy main process may still contain historical
// implementation text, but there is no registered IPC route that can save,
// read, clear, or call those retired integrations. Ask Gemini is the one
// supported Gemini route and was replaced above with the Nexus-owned build
// credential path.
for (const channel of [
  'save-gemini-key',
  'has-gemini-key',
  'clear-gemini-key',
  'save-openai-key',
  'has-openai-key',
  'clear-openai-key',
  'openai-ask',
]) ipcMain.removeHandler(channel);

restoreIpcHandle();
