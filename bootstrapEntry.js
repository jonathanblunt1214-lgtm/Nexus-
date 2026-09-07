// Electron entry point. Register launch-only UI defaults and optional plug-in
// upgrades before the existing bootstrap installs the rest of Nexus.
const { app, safeStorage } = require('electron');
const { createCruciblePluginAccountApi } = require('./cruciblePluginAccount');
const { installCruciblePluginUi } = require('./cruciblePluginUi');

global.nexusPluginPrivateAccountApi = createCruciblePluginAccountApi({ app, safeStorage });

app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-finish-load', () => {
    window.webContents.executeJavaScript(`(() => {
      try {
        // A project is active only after an explicit choice in this launch.
        // Persisted project records remain available, but a stale selection never
        // silently makes Nexus itself (or any other project) active on startup.
        localStorage.removeItem('nexus_active');
        if (typeof activeProjectId !== 'undefined') activeProjectId = null;
        if (typeof openConfigProjectId !== 'undefined') openConfigProjectId = null;
        if (typeof renderProjects === 'function') renderProjects();
        const header = document.getElementById('header-active-name');
        if (header) header.textContent = 'None';
        const shipActive = document.getElementById('ship-active-name');
        if (shipActive) shipActive.textContent = 'none';
        const configActive = document.getElementById('config-active-name');
        if (configActive) configActive.textContent = 'none';

        // Migrate the original 50/50-by-50/50 workspace once. The old default
        // made Live Preview only one quarter of the workspace. New installs and
        // existing installs that have not received this migration get a dominant
        // preview; after that, the user's own resizer choices remain authoritative.
        const layoutVersion = Number(localStorage.getItem('nexus_workspace_layout_version') || '0');
        if (layoutVersion < 2) {
          localStorage.setItem('nexus_workspace_col_fraction', '0.68');
          localStorage.setItem('nexus_workspace_row_fraction', '0.68');
          localStorage.setItem('nexus_workspace_layout_version', '2');
          const grid = document.getElementById('workspace-grid');
          if (grid) {
            grid.style.gridTemplateColumns = '0.68fr 6px 0.32fr';
            grid.style.gridTemplateRows = '0.68fr 6px 0.32fr';
          }
        }

        // Build numbers are assigned automatically from Development source
        // commits. Remove the obsolete manual approval surface so Settings does
        // not contradict the automatic backend behavior.
        const approveBuildButton = document.getElementById('approve-build-number-btn');
        const manualBuildCard = approveBuildButton && approveBuildButton.closest('.card');
        if (manualBuildCard) manualBuildCard.remove();

        // Keep the supported hosted coding providers visible and remove stale
        // local/retired provider affordances from the legacy markup.
        const providerSelect = document.getElementById('coding-model-provider');
        if (providerSelect) {
          const supported = new Set(['nim', 'kimi', 'deepseek']);
          Array.from(providerSelect.options).forEach((option) => {
            if (!supported.has(option.value)) option.remove();
          });
        }
        document.querySelectorAll('button').forEach((button) => {
          const text = (button.textContent || '').trim();
          if (text === 'Get Z.ai key') button.remove();
        });
        Array.from(document.querySelectorAll('.card')).forEach((card) => {
          const text = card.textContent || '';
          if (text.includes('Safe Provider Discovery') && (text.includes('Ollama') || text.includes('LM Studio'))) card.remove();
        });

        // Make AI Code Assist prompt-first. The existing Feature Builder already
        // owns the safe multi-file planning/review path, so this primary prompt
        // feeds that proven backend instead of inventing a second write path.
        const assistBody = document.querySelector('#wp-assist .workspace-panel-body');
        if (assistBody && !document.getElementById('nexus-ai-build-prompt')) {
          const promptCard = document.createElement('div');
          promptCard.className = 'card';
          promptCard.style.flexShrink = '0';
          promptCard.innerHTML = '<label class="label" for="nexus-ai-build-prompt">AI Build Prompt</label>' +
            '<p class="muted small" style="margin-top:6px;">Describe what you want Nexus to build, change, or repair. Nexus plans the affected files, then uses the existing review/guardrail path before writes.</p>' +
            '<textarea id="nexus-ai-build-prompt" rows="5" style="width:100%; margin-top:8px;" placeholder="Example: Add a responsive account settings screen with validation and tests."></textarea>' +
            '<div class="form-row" style="margin-top:8px;"><button class="btn" id="nexus-ai-build-btn">Plan & Build</button></div>';
          assistBody.insertBefore(promptCard, assistBody.firstChild);
          promptCard.querySelector('#nexus-ai-build-btn').addEventListener('click', () => {
            const prompt = promptCard.querySelector('#nexus-ai-build-prompt').value.trim();
            if (!prompt) return;
            if (typeof activeProjectId === 'undefined' || activeProjectId === null) {
              if (typeof showToast === 'function') showToast('error', 'Select a project first', 'AI Build Prompt only runs against a project you explicitly selected.');
              return;
            }
            const featureDescription = document.getElementById('feature-description');
            if (!featureDescription || typeof planFeature !== 'function') {
              if (typeof showToast === 'function') showToast('error', 'Feature Builder unavailable', 'The multi-file planning path is not ready.');
              return;
            }
            featureDescription.value = prompt;
            planFeature();
          });

          const legacyRepairCard = Array.from(assistBody.children).find((node) =>
            node !== promptCard && node.classList && node.classList.contains('card') &&
            (node.textContent || '').includes('Bug Fix Assist'));
          if (legacyRepairCard) {
            const details = document.createElement('details');
            details.style.flexShrink = '0';
            const summary = document.createElement('summary');
            summary.className = 'muted small';
            summary.textContent = 'Targeted file repair (advanced)';
            details.appendChild(summary);
            legacyRepairCard.replaceWith(details);
            details.appendChild(legacyRepairCard);
          }
        }

        // Protect the in-app update control from future Settings markup drift.
        // The current source already contains the button and handler; this only
        // restores the control if a later UI edit accidentally removes it.
        if (!document.getElementById('update-check-btn')) {
          const updateVersion = document.getElementById('update-current-version');
          const updateCard = updateVersion && updateVersion.closest('.card');
          if (updateCard && typeof checkForReleaseUpdate === 'function') {
            const actions = document.createElement('div');
            actions.className = 'form-row update-actions';
            actions.innerHTML = '<button class="btn btn-secondary" id="update-check-btn">Check for updates</button>';
            actions.querySelector('#update-check-btn').addEventListener('click', () => checkForReleaseUpdate());
            updateCard.appendChild(actions);
          }
        }
      } catch (error) {
        console.error('[Nexus] Could not apply launch UI stabilization:', error.message);
      }
    })();`).catch((error) => console.error('[Nexus] Launch UI stabilization failed:', error.message));
    installCruciblePluginUi(window);
  });
});

require('./bootstrap');
