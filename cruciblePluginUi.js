function crucibleRendererUi() {
  // Launch UI stabilization lives in this renderer-side upgrade module so the
  // trusted repository repair engine can continue treating bootstrapEntry.js
  // as a fixed security boundary.
  try {
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

    const approveBuildButton = document.getElementById('approve-build-number-btn');
    const manualBuildCard = approveBuildButton && approveBuildButton.closest('.card');
    if (manualBuildCard) manualBuildCard.remove();

    const providerSelect = document.getElementById('coding-model-provider');
    if (providerSelect) {
      const supported = new Set(['nim', 'kimi', 'deepseek']);
      Array.from(providerSelect.options).forEach((option) => {
        if (!supported.has(option.value)) option.remove();
      });
    }
    document.querySelectorAll('button').forEach((button) => {
      if ((button.textContent || '').trim() === 'Get Z.ai key') button.remove();
    });
    Array.from(document.querySelectorAll('.card')).forEach((card) => {
      const text = card.textContent || '';
      if (text.includes('Safe Provider Discovery') && (text.includes('Ollama') || text.includes('LM Studio'))) card.remove();
    });

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
    console.error('[Nexus] Launch UI stabilization failed:', error.message);
  }

  const invokeCrucible = async (folder, payload) => {
    const results = await window.nexus.pluginsInvokeSlot(folder, 'project-actions', { projectRoot: folder, ...payload });
    const result = Array.isArray(results) ? results.find((item) => item.pluginId === 'the-crucible') : null;
    if (!result?.ok) throw new Error(result?.error || 'The Crucible plug-in did not respond.');
    if (result.value?.ok === false) throw new Error(result.value.message || result.value.error || 'The Crucible action failed.');
    return result.value;
  };

  const activeFolder = () => typeof activeProjectFolder === 'function' ? activeProjectFolder() : null;
  const toast = (type, title, message) => typeof showToast === 'function' ? showToast(type, title, message) : console.log(title, message || '');
  const escapeText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function ensureModal() {
    let modal = document.getElementById('crucible-governance-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'crucible-governance-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(3,7,18,.88);display:none;align-items:center;justify-content:center;padding:24px;';
    modal.innerHTML = `
      <div style="width:min(1180px,96vw);height:min(780px,92vh);background:#0b1220;border:1px solid #334155;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #334155;">
          <div><strong>The Crucible governance</strong><div class="muted small">Edit every text file under governingDocuments/. Changes save to the active project.</div></div>
          <button class="btn btn-secondary" data-crucible-close>Close</button>
        </div>
        <div style="display:grid;grid-template-columns:320px 1fr;min-height:0;flex:1;">
          <div style="border-right:1px solid #334155;padding:12px;overflow:auto;">
            <button class="btn tiny" data-crucible-refresh>Refresh files</button>
            <div data-crucible-files style="margin-top:10px;"></div>
            <div style="margin-top:14px;border-top:1px solid #334155;padding-top:12px;">
              <label class="small">New governance file</label>
              <input data-crucible-new-path placeholder="governingDocuments/..." style="width:100%;margin-top:6px;" />
              <button class="btn tiny" data-crucible-new style="margin-top:6px;">Create / open</button>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;min-width:0;padding:12px;">
            <div class="form-row" style="align-items:center;">
              <input data-crucible-path readonly style="flex:1;" />
              <button class="btn" data-crucible-save disabled>Save governance file</button>
            </div>
            <textarea data-crucible-editor spellcheck="false" style="flex:1;width:100%;margin-top:10px;resize:none;font-family:monospace;white-space:pre;overflow:auto;"></textarea>
            <div data-crucible-status class="muted small" style="margin-top:8px;">Choose a governance file.</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-crucible-close]').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (event) => { if (event.target === modal) modal.style.display = 'none'; });
    return modal;
  }

  async function openGovernanceConfiguration() {
    const folder = activeFolder();
    if (!folder) { toast('error', 'Open a project first', 'Crucible governance belongs to the active project.'); return; }
    const modal = ensureModal();
    const filePanel = modal.querySelector('[data-crucible-files]');
    const pathInput = modal.querySelector('[data-crucible-path]');
    const editor = modal.querySelector('[data-crucible-editor]');
    const save = modal.querySelector('[data-crucible-save]');
    const status = modal.querySelector('[data-crucible-status]');
    const newPath = modal.querySelector('[data-crucible-new-path]');
    modal.style.display = 'flex';

    const openFile = async (file) => {
      pathInput.value = file;
      status.textContent = 'Loading…';
      try {
        const result = await invokeCrucible(folder, { actionId: 'crucible-governance-read', path: file });
        editor.value = result.content || '';
        save.disabled = false;
        status.textContent = 'Loaded. Editing this file changes project governance when you save.';
      } catch {
        editor.value = '';
        save.disabled = false;
        status.textContent = 'New file. Enter content and save to create it.';
      }
    };

    const refresh = async () => {
      filePanel.innerHTML = '<p class="muted small">Loading governance files…</p>';
      try {
        const result = await invokeCrucible(folder, { actionId: 'crucible-governance-list' });
        const files = result.files || [];
        filePanel.innerHTML = files.map((file, index) => `<button class="btn tiny btn-secondary" data-crucible-file="${index}" style="display:block;width:100%;text-align:left;margin:4px 0;white-space:normal;">${escapeText(file)}</button>`).join('') || '<p class="muted small">No governance files yet. Use New governance file or Auto Inject.</p>';
        filePanel.querySelectorAll('[data-crucible-file]').forEach((button) => button.addEventListener('click', () => openFile(files[Number(button.dataset.crucibleFile)])));
      } catch (error) { filePanel.innerHTML = '<p class="muted small">' + escapeText(error.message) + '</p>'; }
    };

    modal.querySelector('[data-crucible-refresh]').onclick = refresh;
    modal.querySelector('[data-crucible-new]').onclick = () => {
      let value = newPath.value.trim().replace(/\\/g, '/');
      if (!value) return;
      if (!value.startsWith('governingDocuments/')) value = 'governingDocuments/' + value.replace(/^\/+/, '');
      openFile(value);
    };
    save.onclick = async () => {
      if (!pathInput.value) return;
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        await invokeCrucible(folder, { actionId: 'crucible-governance-save', path: pathInput.value, content: editor.value });
        status.textContent = 'Saved to the active project.';
        toast('success', 'Crucible governance saved', pathInput.value);
        await refresh();
      } catch (error) { status.textContent = error.message; toast('error', 'Governance save failed', error.message); }
      finally { save.disabled = false; }
    };
    await refresh();
  }

  async function showPrivateTracking() {
    const folder = activeFolder();
    if (!folder) { toast('error', 'Open a project first'); return; }
    try {
      const result = await invokeCrucible(folder, { actionId: 'crucible-tracking-list' });
      const rows = result.injections || [];
      const text = rows.length
        ? rows.map((item) => `${new Date(item.timestamp).toLocaleString()} · ${item.action} · ${(item.files || []).join(', ')}`).join('\n\n')
        : 'No Crucible injections are recorded for this project in the currently signed-in Nexus account.';
      alert('My Crucible injection history\n\n' + text);
    } catch (error) { toast('error', 'Private injection history unavailable', error.message); }
  }

  const panel = document.getElementById('plugin-security-list');
  if (!panel || panel.dataset.crucibleConfigurationObserver === 'true') return;
  panel.dataset.crucibleConfigurationObserver = 'true';
  let decorating = false;
  const decorate = () => {
    if (decorating) return;
    decorating = true;
    try {
      const cards = Array.from(panel.querySelectorAll('.suggestion-item'));
      const card = cards.find((item) => (item.querySelector('strong')?.textContent || '').trim() === 'The Crucible');
      if (!card || card.querySelector('[data-crucible-plugin-config]')) return;
      const active = /\bACTIVE\b/.test(card.textContent || '');
      const controls = document.createElement('div');
      controls.dataset.cruciblePluginConfig = 'true';
      controls.style.marginTop = '8px';
      controls.innerHTML = `
        <div class="form-row" style="align-items:center;flex-wrap:wrap;">
          <label style="display:inline-flex;align-items:center;gap:6px;"><input type="checkbox" data-crucible-auto ${active ? '' : 'disabled'} /> Auto Inject The Crucible</label>
          <button class="btn tiny" data-crucible-apply disabled>Apply selected option</button>
          <button class="btn tiny btn-secondary" data-crucible-configure ${active ? '' : 'disabled'}>Configure governance</button>
          <button class="btn tiny btn-secondary" data-crucible-history ${active ? '' : 'disabled'}>My injection history</button>
        </div>
        <div class="muted small" style="margin-top:5px;">Auto Inject is off by default. Governance editing is project-visible; injection tracking is visible only inside the Nexus account that performed it.</div>`;
      const checkbox = controls.querySelector('[data-crucible-auto]');
      const apply = controls.querySelector('[data-crucible-apply]');
      checkbox.addEventListener('change', () => { apply.disabled = !checkbox.checked || !active; });
      apply.addEventListener('click', async () => {
        const folder = activeFolder(); if (!folder || !checkbox.checked) return;
        if (!confirm('Auto Inject The Crucible into the active project? Existing bootstrap files will not be overwritten.')) return;
        apply.disabled = true;
        try {
          const result = await invokeCrucible(folder, { actionId:'crucible-auto-inject', selected:true, confirmed:true, overwrite:false });
          toast(result.tracking?.ok === false ? 'info' : 'success', 'The Crucible injected', result.message || 'Injection completed.');
          checkbox.checked = false;
        } catch (error) { toast('error', 'Crucible Auto Inject failed', error.message); }
        finally { apply.disabled = true; }
      });
      controls.querySelector('[data-crucible-configure]').addEventListener('click', openGovernanceConfiguration);
      controls.querySelector('[data-crucible-history]').addEventListener('click', showPrivateTracking);
      card.appendChild(controls);
    } finally { decorating = false; }
  };
  new MutationObserver(() => queueMicrotask(decorate)).observe(panel, { childList:true, subtree:true });
  decorate();
}

function installCruciblePluginUi(window) {
  const source = `(${crucibleRendererUi.toString()})()`;
  window.webContents.executeJavaScript(source).catch((error) => console.error('[Nexus] Crucible plugin UI failed:', error.message));
}

module.exports = { installCruciblePluginUi, crucibleRendererUi };
