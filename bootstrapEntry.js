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
    })();`).catch((error) => console.error('[Nexus] Active-project launch default failed:', error.message));
  });
});

require('./bootstrap');
