// Preload for the hidden App Check broker window (see appCheckBroker.js).
// This is the ONLY bridge the remote broker page gets into Electron. It can
// report a token or an error over IPC; it cannot reach ipcRenderer, Node, or
// any other Electron API directly, because contextIsolation + sandbox keep
// the page's own JavaScript in an isolated world.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusAppCheckBridge', {
  reportToken: (token, expiresAtMs) => {
    ipcRenderer.send('appcheck-broker:token', { token: String(token || ''), expiresAtMs: Number(expiresAtMs) || 0 });
  },
  reportError: (message) => {
    ipcRenderer.send('appcheck-broker:error', { message: String(message || 'Unknown App Check broker error.') });
  },
});
