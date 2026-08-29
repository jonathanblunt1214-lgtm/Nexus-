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

// The legacy main process already owns encrypted provider persistence. Wrap
// only the coding-provider and project-owned service channels that remain
// part of Nexus's supported Settings/runtime surface. Build numbering is also
// captured here so a new source commit receives its number automatically once.
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
    'build-number:approve',
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
        const hostedProviders = new Set(['nim', 'kimi', 'deepseek']);
        result.providers = result.providers.filter((item) => hostedProviders.has(item.id));
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


    return securedHandle(channel, listener);
  };

  const restore = () => { ipcMain.handle = securedHandle; };
  restore.autoAssignBuild = async () => {
    const assignHandler = handlers.get('build-number:approve');
    if (!assignHandler) return null;
    // buildNumber.js makes this call idempotent for the current commit, so
    // retries and repeated launches do not burn extra build numbers.
    return assignHandler(null, { approved:true, automatic:true });
  };
  return restore;
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
          select.querySelector('option[value="ollama"]')?.remove();
          select.querySelector('option[value="lmstudio"]')?.remove();
          const configured = /key saved/i.test(status?.textContent || '');
          key.disabled = configured;
          key.style.display = configured ? 'none' : '';
          key.value = '';
          key.placeholder = 'API key for ' + (select.selectedOptions[0]?.textContent?.trim() || 'selected provider');
          const row = key.closest('.form-row');
          const saveButton = row?.querySelector('button[onclick="saveCodingModelProviderKey()"]');
          if (saveButton) saveButton.style.display = configured ? 'none' : '';
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

        // Build numbering is automatic now. There is no user approval step.
        document.getElementById('approve-build-number-btn')?.remove();
        const buildNext = document.getElementById('approved-build-next');
        const buildCard = buildNext?.closest('.card');
        if (buildCard) {
          const helper = Array.from(buildCard.querySelectorAll('p.muted.small')).at(-1);
          if (helper) helper.textContent = 'Build numbers are assigned automatically once per new Nexus source commit. Re-opening or retrying the same commit does not increment again. 1.0.0 remains reserved for public launch.';
        }

        const discovery = cardByLabelPrefix('Safe Provider Discovery');
        if (!discovery || discovery.dataset.hostedKeysReady === 'true') return;
        discovery.dataset.hostedKeysReady = 'true';

        discovery.querySelectorAll('button').forEach((button) => {
          const text = (button.textContent || '').trim();
          if (text.includes('Z.ai') || text.includes('Detect local models')) button.remove();
        });
        const description = discovery.querySelector('p.muted');
        if (description) description.textContent = 'Nexus shows whether your supported hosted provider keys are already configured without ever displaying the saved secret. You can also detect supported environment-variable names and import them explicitly.';

        const results = document.getElementById('provider-discovery-results');
        const hosted = document.createElement('div');
        hosted.id = 'safe-provider-hosted-keys';
        hosted.style.display = 'grid';
        hosted.style.gap = '8px';
        hosted.style.marginTop = '10px';

        const refreshButton = document.createElement('button');
        refreshButton.className = 'btn';
        refreshButton.textContent = 'Refresh provider status';
        refreshButton.style.marginTop = '8px';
        discovery.insertBefore(refreshButton, hosted);

        const providers = [
          { id:'nim', label:'NVIDIA NIM', placeholder:'NVIDIA NIM API key' },
          { id:'kimi', label:'Kimi', placeholder:'Kimi API key' },
          { id:'deepseek', label:'DeepSeek', placeholder:'DeepSeek API key' },
        ];
        const providerRows = new Map();

        const renderProviderState = (provider, state, configured, selected) => {
          const rowState = providerRows.get(provider.id);
          if (!rowState) return;
          rowState.input.value = '';
          rowState.entry.style.display = configured ? 'none' : '';
          rowState.replace.style.display = configured ? '' : 'none';
          rowState.clear.style.display = configured ? '' : 'none';
          rowState.state.textContent = configured
            ? 'Configured · key hidden' + (selected ? ' · ACTIVE' : '')
            : 'Not configured';
          if (state) rowState.state.dataset.providerState = state;
        };

        const refreshHostedKeyRows = async () => {
          try {
            const response = await window.nexus.codingModelsStatus();
            if (!response?.ok) throw new Error(response?.error || 'Could not read provider status.');
            for (const provider of providers) {
              const current = response.providers.find((item) => item.id === provider.id);
              renderProviderState(provider, 'ready', Boolean(current?.configured), response.selected === provider.id);
            }
          } catch (error) {
            for (const provider of providers) {
              const rowState = providerRows.get(provider.id);
              if (rowState) rowState.state.textContent = error.message;
            }
          }
        };

        for (const provider of providers) {
          const row = document.createElement('div');
          row.className = 'suggestion-item';
          const title = document.createElement('strong');
          title.textContent = provider.label;

          const entry = document.createElement('div');
          entry.className = 'form-row';
          entry.style.marginTop = '6px';
          const input = document.createElement('input');
          input.type = 'password';
          input.autocomplete = 'new-password';
          input.placeholder = provider.placeholder;
          input.id = 'safe-provider-key-' + provider.id;
          const save = document.createElement('button');
          save.className = 'btn';
          save.textContent = 'Save & Activate';
          entry.append(input, save);

          const actions = document.createElement('div');
          actions.className = 'form-row';
          actions.style.marginTop = '6px';
          const replace = document.createElement('button');
          replace.className = 'btn btn-secondary';
          replace.textContent = 'Replace key';
          replace.style.display = 'none';
          const clear = document.createElement('button');
          clear.className = 'btn btn-secondary';
          clear.textContent = 'Clear key';
          clear.style.display = 'none';
          actions.append(replace, clear);

          const state = document.createElement('span');
          state.className = 'muted small';
          state.id = 'safe-provider-status-' + provider.id;
          state.textContent = 'Checking…';

          providerRows.set(provider.id, { row, entry, input, save, actions, replace, clear, state });

          save.addEventListener('click', async () => {
            const value = input.value.trim();
            if (!value) { state.textContent = 'Enter a key first.'; return; }
            save.disabled = true;
            state.textContent = 'Saving…';
            try {
              const result = await window.nexus.saveCodingModelKey(provider.id, value);
              input.value = '';
              if (!result?.ok) {
                state.textContent = result?.error || 'Could not save key.';
                return;
              }
              await refreshHostedKeyRows();
              if (typeof window.refreshCodingModels === 'function') await window.refreshCodingModels();
            } catch (error) {
              input.value = '';
              state.textContent = error.message;
            } finally {
              save.disabled = false;
            }
          });

          replace.addEventListener('click', () => {
            entry.style.display = '';
            input.value = '';
            input.focus();
            state.textContent = 'Existing key remains stored until you save a replacement.';
          });

          clear.addEventListener('click', async () => {
            clear.disabled = true;
            state.textContent = 'Clearing…';
            try {
              const result = await window.nexus.clearCodingModelKey(provider.id);
              if (!result?.ok) {
                state.textContent = result?.error || 'Could not clear key.';
                return;
              }
              await refreshHostedKeyRows();
              if (typeof window.refreshCodingModels === 'function') await window.refreshCodingModels();
            } catch (error) {
              state.textContent = error.message;
            } finally {
              clear.disabled = false;
            }
          });

          row.append(title, entry, actions, state);
          hosted.appendChild(row);
        }

        if (results) discovery.insertBefore(hosted, results);
        else discovery.appendChild(hosted);

        const renderEnvironmentDiscovery = async () => {
          if (!results) return;
          results.innerHTML = '<p class="muted small">Checking supported environment-variable names…</p>';
          try {
            const discovered = await window.nexus.discoverProviders();
            if (!discovered?.ok) throw new Error(discovered?.error || 'Provider discovery failed.');
            const environmentKeys = Array.isArray(discovered.environmentKeys) ? discovered.environmentKeys : [];
            if (!environmentKeys.length) {
              results.innerHTML = '<p class="muted small">No additional supported provider environment variables were detected. Saved Nexus keys are shown above.</p>';
              return;
            }
            results.innerHTML = '<p class="label">Available environment imports</p>';
            for (const item of environmentKeys) {
              const row = document.createElement('div');
              row.className = 'suggestion-item';
              const title = document.createElement('strong');
              title.textContent = item.name;
              const detail = document.createElement('span');
              detail.className = 'muted small';
              detail.textContent = 'Found ' + item.env + '; value remains hidden.';
              const importButton = document.createElement('button');
              importButton.className = 'btn tiny';
              importButton.textContent = 'Import detected key';
              importButton.addEventListener('click', async () => {
                importButton.disabled = true;
                try {
                  const imported = await window.nexus.importEnvironmentProviderKey(item.env);
                  if (!imported?.ok) throw new Error(imported?.error || 'Import failed.');
                  await refreshHostedKeyRows();
                  await renderEnvironmentDiscovery();
                } catch (error) {
                  detail.textContent = error.message;
                } finally {
                  importButton.disabled = false;
                }
              });
              row.append(title, detail, importButton);
              results.appendChild(row);
            }
          } catch (error) {
            results.innerHTML = '<p class="muted small">' + String(error.message || error) + '</p>';
          }
        };

        refreshButton.addEventListener('click', async () => {
          await refreshHostedKeyRows();
          await renderEnvironmentDiscovery();
        });

        window.discoverSafeProviders = async () => {
          await refreshHostedKeyRows();
          await renderEnvironmentDiscovery();
        };

        refreshHostedKeyRows();
        renderEnvironmentDiscovery();
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


// Assign the build only after the main process has initialized config and the
// window has finished loading. The commit-keyed state makes this safe to retry.
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      await restoreIpcHandle.autoAssignBuild?.();
      await window.webContents.executeJavaScript(`typeof loadBuildInfoAndCheckUpdates === 'function' ? loadBuildInfoAndCheckUpdates() : undefined`);
    } catch (error) {
      console.error('[Nexus] Automatic build-number assignment failed:', error.message);
    }
  });
});

restoreIpcHandle();
