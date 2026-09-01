// Nexus bootstrap: registers narrowly scoped upgrade IPC before loading the legacy main process.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app, ipcMain, webContents, dialog, safeStorage } = require('electron');
const { registerSection7Ipc } = require('./section7Ipc');
const { registerSection8Ipc } = require('./section8Ipc');
const { CrucibleLearningIdentity } = require('./crucibleLearningIdentity');
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

function readStoredGithubToken() {
  try {
    const configPath = path.join(app.getPath('userData'), 'nexus-config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (cfg.githubTokenEnc && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(cfg.githubTokenEnc, 'base64'));
    }
    return cfg.githubTokenPlain || cfg.githubToken || null;
  } catch {
    return null;
  }
}

function crucibleIdentityProvider(projectRoot) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is required for trusted Crucible OIDC identity.');
  const configPath = path.join(app.getPath('userData'), 'crucible-learning-identities.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  const fingerprint = require('crypto').createHash('sha256').update(canonicalProjectPath(projectRoot)).digest('hex');
  const encrypted = cfg.identities?.[fingerprint];
  let material = null;
  if (encrypted) material = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')));
  const identity = new CrucibleLearningIdentity(projectRoot, material);
  if (!encrypted) {
    cfg.identities = { ...(cfg.identities || {}), [fingerprint]: safeStorage.encryptString(JSON.stringify(identity.exportMaterial())).toString('base64') };
    const temp = `${configPath}.crucible-${process.pid}-${Date.now()}.tmp`;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify(cfg, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, configPath);
  }
  return identity;
}

function runGitProcess(folder, args, env = process.env) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd:folder, env, timeout:30_000, maxBuffer:10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = String(stdout || '') + (stderr ? '\n' + String(stderr) : '');
      resolve({ ok:!error, output:output.trim(), error:error ? (output.trim() || error.message) : null });
    });
  });
}

async function retryAuthenticatedGithubPush(folder) {
  if (!folder) return { ok:false, error:'Project folder is missing.' };
  const remote = await runGitProcess(folder, ['remote', 'get-url', 'origin']);
  if (!remote.ok || !/github\.com[/:]/i.test(remote.output)) return { ok:false, skipped:true, error:'No GitHub origin remote is configured.' };

  const token = readStoredGithubToken();
  if (!token) return { ok:false, authRequired:true, error:'Connect GitHub in Nexus Settings so Auto Save/Push can authenticate without a separate Git credential prompt.' };

  const basic = Buffer.from('x-access-token:' + token, 'utf8').toString('base64');
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT:'0',
    GIT_CONFIG_COUNT:'1',
    GIT_CONFIG_KEY_0:'http.extraHeader',
    GIT_CONFIG_VALUE_0:'Authorization: Basic ' + basic,
  };
  const pushed = await runGitProcess(folder, ['push', '-u', 'origin', 'HEAD'], env);
  return pushed.ok
    ? { ok:true, authenticated:true, output:pushed.output }
    : { ok:false, authenticated:true, error:pushed.error || 'GitHub push failed.' };
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
    'git-auto-sync',
    'git-push',
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
        if (!selected?.ok) return { ok:true, activated:false, error:'Key saved, but activation failed: ' + (selected.error || 'unknown error') };
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

    if (channel === 'git-auto-sync' || channel === 'git-push') {
      return securedHandle(channel, async (event, payload = {}) => {
        const result = await listener(event, payload);
        if (result?.ok || result?.skipped || result?.protectedBranch) return result;
        const retry = await retryAuthenticatedGithubPush(payload.folder);
        if (!retry.ok) {
          return { ...result, error:retry.error || result?.error || 'GitHub push failed.', authRequired:Boolean(retry.authRequired) };
        }
        return {
          ...result,
          ok:true,
          error:undefined,
          authenticated:true,
          changed:Boolean(result?.changed || result?.committed),
          output:retry.output,
        };
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
        let providerReplaceMode = false;

        const providerRow = key?.closest('.form-row');
        const providerSaveButton = providerRow?.querySelector('button[onclick="saveCodingModelProviderKey()"]');
        const providerClearButton = providerRow?.querySelector('button[onclick="clearCodingModelProviderKey()"]');
        let providerReplaceButton = providerRow?.querySelector('[data-provider-replace-key]');
        if (providerRow && !providerReplaceButton) {
          providerReplaceButton = document.createElement('button');
          providerReplaceButton.className = 'btn btn-secondary';
          providerReplaceButton.textContent = 'Replace key';
          providerReplaceButton.dataset.providerReplaceKey = 'true';
          providerReplaceButton.style.display = 'none';
          providerRow.insertBefore(providerReplaceButton, providerClearButton || null);
          providerReplaceButton.addEventListener('click', () => {
            providerReplaceMode = true;
            key.style.display = '';
            key.disabled = false;
            key.value = '';
            if (providerSaveButton) providerSaveButton.style.display = '';
            providerReplaceButton.style.display = 'none';
            key.focus();
          });
        }

        const syncProviderCardFromState = async () => {
          if (!select || !key) return false;
          select.querySelector('option[value="glm"]')?.remove();
          select.querySelector('option[value="ollama"]')?.remove();
          select.querySelector('option[value="lmstudio"]')?.remove();
          try {
            const response = await window.nexus.codingModelsStatus();
            if (!response?.ok) return false;
            const current = response.providers.find((item) => item.id === select.value);
            const configured = Boolean(current?.configured);
            if (configured && !providerReplaceMode) {
              key.value = '';
              key.disabled = true;
              key.style.display = 'none';
              if (providerSaveButton) providerSaveButton.style.display = 'none';
              if (providerReplaceButton) providerReplaceButton.style.display = '';
            } else {
              key.disabled = Boolean(current?.keyless);
              key.style.display = '';
              key.value = '';
              if (providerSaveButton) providerSaveButton.style.display = current?.keyless ? 'none' : '';
              if (providerReplaceButton) providerReplaceButton.style.display = 'none';
            }
            key.placeholder = current?.keyless ? 'No API key required' : 'API key for ' + (current?.name || select.selectedOptions[0]?.textContent?.trim() || 'selected provider');
            if (configured && status) {
              const active = response.selected === select.value ? 'Active' : 'Available';
              status.textContent = active + ' · ' + (current?.model || '') + ' · Configured · key hidden';
            }
            return configured;
          } catch {
            return false;
          }
        };

        if (select) select.addEventListener('change', () => {
          providerReplaceMode = false;
          setTimeout(syncProviderCardFromState, 0);
        });
        if (providerSaveButton) providerSaveButton.addEventListener('click', () => {
          providerReplaceMode = false;
          let attempts = 0;
          const poll = setInterval(async () => {
            attempts += 1;
            const configured = await syncProviderCardFromState();
            if (configured || attempts >= 20) clearInterval(poll);
          }, 150);
        });
        if (providerClearButton) providerClearButton.addEventListener('click', () => {
          providerReplaceMode = false;
          setTimeout(syncProviderCardFromState, 300);
        });
        syncProviderCardFromState();

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

        // Official language services auto-detect commands on PATH. Manual
        // selection is now only shown for services that still need a custom path.
        const languageCard = cardByLabelPrefix('Official Local Language Services');
        const languageActions = languageCard?.querySelector('button[onclick="refreshLanguageServices()"]')?.closest('.form-row');
        if (languageCard) {
          const description = languageCard.querySelector('p.muted.small');
          if (description) description.textContent = 'Pyright is included with Nexus. JDT LS, Roslyn, clangd, PowerShell Editor Services, Dart, and Swift are detected automatically when their official tools are available on PATH or already configured. Select a service only when it is installed in a non-standard location.';
        }
        if (languageActions) {
          languageActions.style.display = 'grid';
          languageActions.style.gridTemplateColumns = 'repeat(auto-fit, minmax(150px, 1fr))';
          languageActions.style.gap = '8px';
          languageActions.style.alignItems = 'stretch';
          languageActions.querySelectorAll('button').forEach((button) => {
            button.style.whiteSpace = 'normal';
            button.style.minWidth = '0';
            button.style.width = '100%';
          });
        }
        const languageButtons = new Map([
          ['jdtls', languageActions?.querySelector('button[onclick="chooseLanguageService(\'jdtls\')"]')],
          ['roslyn', languageActions?.querySelector('button[onclick="chooseLanguageService(\'roslyn\')"]')],
          ['clangd', languageActions?.querySelector('button[onclick="chooseLanguageService(\'clangd\')"]')],
          ['powershell-editor-services', languageActions?.querySelector('button[onclick="chooseLanguageService(\'powershellEditorServices\')"]')],
          ['dart-language-server', languageActions?.querySelector('button[onclick="chooseLanguageService(\'dart\')"]')],
          ['sourcekit-lsp', languageActions?.querySelector('button[onclick="chooseLanguageService(\'sourcekitLsp\')"]')],
        ]);
        const syncLanguageServiceControls = async () => {
          if (!languageCard) return;
          try {
            const response = await window.nexus.languageServicesStatus();
            if (!response?.ok || !Array.isArray(response.providers)) return;
            for (const provider of response.providers) {
              const button = languageButtons.get(provider.id);
              if (button) button.hidden = Boolean(provider.configured);
            }
          } catch {}
        };
        const refreshLanguageButton = languageActions?.querySelector('button[onclick="refreshLanguageServices()"]');
        refreshLanguageButton?.addEventListener('click', () => setTimeout(syncLanguageServiceControls, 250));
        languageButtons.forEach((button) => button?.addEventListener('click', () => setTimeout(syncLanguageServiceControls, 500)));
        syncLanguageServiceControls();

        // Development-build provider identifiers save themselves when edited.
        // Secret fields are cleared immediately after encrypted persistence.
        const accountDetails = Array.from(document.querySelectorAll('details')).find((details) => (details.querySelector('summary')?.textContent || '').includes('Account provider configuration for development builds'));
        if (accountDetails && accountDetails.dataset.autoConfigReady !== 'true') {
          accountDetails.dataset.autoConfigReady = 'true';
          accountDetails.querySelector('button[onclick="saveOAuthConfiguration()"]')?.remove();
          accountDetails.querySelector('button[onclick="saveEmailAccountConfiguration()"]')?.remove();
          const accountAutoStatus = document.createElement('p');
          accountAutoStatus.id = 'account-provider-auto-status';
          accountAutoStatus.className = 'muted small';
          accountAutoStatus.style.marginTop = '8px';
          accountAutoStatus.textContent = 'Changes save automatically. Stored client secrets are encrypted and hidden after entry.';
          accountDetails.appendChild(accountAutoStatus);

          const oauthIds = ['oauth-github-client-id','oauth-google-client-id','oauth-google-client-secret','oauth-wordpress-client-id','oauth-wordpress-client-secret'];
          let oauthTimer = null;
          const saveOauthAutomatically = (changedId) => {
            clearTimeout(oauthTimer);
            oauthTimer = setTimeout(async () => {
              const payload = {
                githubClientId:document.getElementById('oauth-github-client-id')?.value.trim() || '',
                googleClientId:document.getElementById('oauth-google-client-id')?.value.trim() || '',
                wordpressClientId:document.getElementById('oauth-wordpress-client-id')?.value.trim() || '',
              };
              if (changedId === 'oauth-google-client-secret') {
                const value = document.getElementById(changedId)?.value.trim() || '';
                if (value) payload.googleClientSecret = value;
              }
              if (changedId === 'oauth-wordpress-client-secret') {
                const value = document.getElementById(changedId)?.value.trim() || '';
                if (value) payload.wordpressClientSecret = value;
              }
              accountAutoStatus.textContent = 'Saving account provider configuration…';
              try {
                const result = await window.nexus.oauthConfigure(payload);
                if (!result?.ok) throw new Error(result?.error || 'Could not save OAuth configuration.');
                if (changedId === 'oauth-google-client-secret' || changedId === 'oauth-wordpress-client-secret') {
                  const field = document.getElementById(changedId);
                  if (field) { field.value = ''; field.placeholder = 'Configured · hidden'; }
                }
                accountAutoStatus.textContent = 'Account provider configuration saved automatically.';
              } catch (error) {
                accountAutoStatus.textContent = 'Could not auto-save account provider configuration: ' + String(error.message || error);
              }
            }, 250);
          };
          for (const id of oauthIds) {
            const field = document.getElementById(id);
            field?.addEventListener('change', () => saveOauthAutomatically(id));
            field?.addEventListener('keydown', (event) => { if (event.key === 'Enter') field.blur(); });
          }

          const emailIds = ['firebase-project-id','firebase-web-api-key','firebase-storage-bucket','firebase-appcheck-broker-url'];
          let emailTimer = null;
          const saveEmailAutomatically = () => {
            clearTimeout(emailTimer);
            emailTimer = setTimeout(async () => {
              accountAutoStatus.textContent = 'Saving Firebase development configuration…';
              try {
                const result = await window.nexus.emailAccountConfigure({
                  projectId:document.getElementById('firebase-project-id')?.value.trim() || '',
                  apiKey:document.getElementById('firebase-web-api-key')?.value.trim() || '',
                  storageBucket:document.getElementById('firebase-storage-bucket')?.value.trim() || '',
                  appCheckBrokerUrl:document.getElementById('firebase-appcheck-broker-url')?.value.trim() || '',
                });
                if (!result?.ok) throw new Error(result?.error || 'Could not save Firebase configuration.');
                accountAutoStatus.textContent = 'Firebase development configuration saved automatically.';
              } catch (error) {
                accountAutoStatus.textContent = 'Could not auto-save Firebase development configuration: ' + String(error.message || error);
              }
            }, 250);
          };
          for (const id of emailIds) {
            const field = document.getElementById(id);
            field?.addEventListener('change', saveEmailAutomatically);
            field?.addEventListener('keydown', (event) => { if (event.key === 'Enter') field.blur(); });
          }
        }

        // Preserve the existing explicit opt-in for timed pushes, but make the
        // enabled default interval reliable and show the exact project error.
        if (typeof window.runGitHubAutoSync === 'function' && !window.runGitHubAutoSync.__nexusDetailedStatus) {
          const originalRunGitHubAutoSync = window.runGitHubAutoSync;
          const detailedRun = async function() {
            if (typeof saveAllDirtyEditorFiles !== 'function' || typeof projects === 'undefined' || typeof githubAutoSyncRunning === 'undefined') {
              return originalRunGitHubAutoSync();
            }
            if (githubAutoSyncRunning) return;
            githubAutoSyncRunning = true;
            const syncStatus = document.getElementById('github-auto-sync-status');
            let pushed = 0;
            const failureDetails = [];
            let skipped = 0;
            if (syncStatus) syncStatus.textContent = 'Checking projects for changes…';
            try {
              const saveResult = await saveAllDirtyEditorFiles('Timed Auto Save before GitHub push');
              if (!saveResult.ok) {
                const message = saveResult.failures.join('; ');
                if (syncStatus) syncStatus.textContent = 'Auto Save failed: ' + message;
                if (typeof showToast === 'function') showToast('error', 'Auto Save failed', message);
                return;
              }
              for (const project of projects) {
                const result = await window.nexus.gitAutoSync(project.folder, project.name);
                if (result.ok && result.changed) pushed += 1;
                else if (result.skipped) skipped += 1;
                else if (!result.ok) failureDetails.push(project.name + ': ' + (result.error || 'unknown Git error'));
              }
              const checkedAt = new Date().toLocaleTimeString();
              if (failureDetails.length) {
                if (syncStatus) syncStatus.textContent = 'Last checked ' + checkedAt + ': ' + pushed + ' pushed, ' + failureDetails.length + ' failed — ' + failureDetails.join(' | ');
                if (typeof showToast === 'function') showToast('error', 'Auto Save/Push needs attention', failureDetails.join('\n'));
              } else {
                const pushedText = pushed ? pushed + ' project(s) pushed' : 'no changes';
                const skippedText = skipped ? '; ' + skipped + ' skipped' : '';
                if (syncStatus) syncStatus.textContent = 'Last checked ' + checkedAt + ': ' + pushedText + skippedText + '.';
                if (pushed || saveResult.saved) {
                  if (typeof showToast === 'function') showToast('success', 'Auto Save/Push complete', saveResult.saved + ' file(s) saved; ' + pushed + ' project(s) pushed.');
                }
              }
            } finally {
              githubAutoSyncRunning = false;
            }
          };
          detailedRun.__nexusDetailedStatus = true;
          window.runGitHubAutoSync = detailedRun;
          if (typeof readGitHubAutoSyncSettings === 'function' && typeof scheduleGitHubAutoSync === 'function' && readGitHubAutoSyncSettings().enabled) {
            scheduleGitHubAutoSync();
          }
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
        if (results) discovery.insertBefore(refreshButton, results);
        else discovery.appendChild(refreshButton);

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
              await syncProviderCardFromState();
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
              await syncProviderCardFromState();
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
                  await syncProviderCardFromState();
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
          await syncProviderCardFromState();
        });

        window.discoverSafeProviders = async () => {
          await refreshHostedKeyRows();
          await renderEnvironmentDiscovery();
          await syncProviderCardFromState();
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
  identityProviderFactory: crucibleIdentityProvider,
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
