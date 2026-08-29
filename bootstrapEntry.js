// Electron entry point. Register launch-only UI defaults before the existing
// bootstrap installs the rest of Nexus. A project becomes active only after
// an explicit user action in the renderer (launch, configuration, or creation).
const { app } = require('electron');

app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-finish-load', () => {
    window.webContents.executeJavaScript(`(() => {
      try {
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
      } catch (error) {
        console.error('[Nexus] Could not reset launch active-project state:', error.message);
      }

      const installCrucibleAutoInjectOption = () => {
        const panel = document.getElementById('plugin-security-list');
        if (!panel || panel.dataset.crucibleAutoInjectObserver === 'true') return;
        panel.dataset.crucibleAutoInjectObserver = 'true';

        let decorating = false;
        const decorate = () => {
          if (decorating) return;
          decorating = true;
          try {
            const cards = Array.from(panel.querySelectorAll('.suggestion-item'));
            const crucibleCard = cards.find((card) => (card.querySelector('strong')?.textContent || '').trim() === 'The Crucible');
            if (!crucibleCard || crucibleCard.querySelector('[data-crucible-auto-inject-option]')) return;

            const active = /\\bACTIVE\\b/.test(crucibleCard.textContent || '');
            const row = document.createElement('div');
            row.dataset.crucibleAutoInjectOption = 'true';
            row.className = 'form-row';
            row.style.marginTop = '8px';
            row.style.alignItems = 'center';

            const label = document.createElement('label');
            label.style.display = 'inline-flex';
            label.style.alignItems = 'center';
            label.style.gap = '6px';
            label.style.cursor = active ? 'pointer' : 'not-allowed';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = false;
            checkbox.disabled = !active;
            checkbox.setAttribute('aria-label', 'Select Crucible Auto Inject');

            const text = document.createElement('span');
            text.textContent = 'Auto Inject The Crucible';
            label.append(checkbox, text);

            const apply = document.createElement('button');
            apply.className = 'btn tiny';
            apply.textContent = 'Apply selected option';
            apply.disabled = true;

            const note = document.createElement('span');
            note.className = 'muted small';
            note.textContent = active
              ? 'Off by default. Selecting this writes the bundled Crucible governance bootstrap to this project.'
              : 'Enable The Crucible plug-in first. Auto Inject remains off by default.';

            checkbox.addEventListener('change', () => {
              apply.disabled = !checkbox.checked || !active;
            });

            apply.addEventListener('click', async () => {
              const folder = typeof activeProjectFolder === 'function' ? activeProjectFolder() : null;
              if (!folder) {
                if (typeof showToast === 'function') showToast('error', 'Open a project first', 'Auto Inject applies only to the active project.');
                return;
              }
              if (!checkbox.checked) return;
              const approved = confirm('Auto Inject The Crucible into the active project? Existing Crucible bootstrap files will not be overwritten unless separately authorized.');
              if (!approved) { checkbox.checked = false; apply.disabled = true; return; }

              apply.disabled = true;
              apply.textContent = 'Injecting…';
              try {
                const results = await window.nexus.pluginsInvokeSlot(folder, 'project-actions', {
                  projectRoot: folder,
                  actionId: 'crucible-auto-inject',
                  selected: true,
                  confirmed: true,
                  overwrite: false,
                });
                const crucible = Array.isArray(results) ? results.find((item) => item.pluginId === 'the-crucible') : null;
                if (!crucible?.ok || !crucible.value?.ok) throw new Error(crucible?.error || crucible?.value?.message || 'The Crucible Auto Inject action did not complete.');
                if (typeof showToast === 'function') showToast('success', 'The Crucible injected', crucible.value.message || 'Crucible governance bootstrap added to the active project.');
                checkbox.checked = false;
              } catch (error) {
                if (typeof showToast === 'function') showToast('error', 'Crucible Auto Inject failed', error.message);
                else console.error('[Nexus] Crucible Auto Inject failed:', error);
              } finally {
                apply.textContent = 'Apply selected option';
                apply.disabled = !checkbox.checked;
              }
            });

            row.append(label, apply, note);
            crucibleCard.appendChild(row);
          } finally {
            decorating = false;
          }
        };

        const observer = new MutationObserver(() => queueMicrotask(decorate));
        observer.observe(panel, { childList: true, subtree: true });
        decorate();
      };

      installCrucibleAutoInjectOption();
    })();`).catch((error) => console.error('[Nexus] Launch UI upgrade failed:', error.message));
  });
});

require('./bootstrap');
