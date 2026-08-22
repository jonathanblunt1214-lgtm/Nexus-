// Nexus bootstrap: registers narrowly scoped upgrade IPC before loading the legacy main process.
const fs = require('fs');
const path = require('path');
const { ipcMain, webContents, dialog } = require('electron');
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
require('./main.js');
