const path = require('path');
const { captureLocalPreview, buildMultimodalPrompt } = require('./visualContext');
const { RuntimeDebugger } = require('./runtimeDebugger');

const debuggers = new Map();

function getDebugger(folder) {
  if (typeof folder !== 'string' || !folder.trim()) throw new Error('folder is required');
  const root = path.resolve(folder);
  let debuggerCtl = debuggers.get(root);
  if (!debuggerCtl) {
    debuggerCtl = new RuntimeDebugger({ workspaceRoot: root });
    debuggers.set(root, debuggerCtl);
  }
  return debuggerCtl;
}

function registerSection7Ipc({ ipcMain, webContents }) {
  ipcMain.handle('vision:capture-preview', async (_event, { webContentsId, rect } = {}) => {
    if (!Number.isInteger(webContentsId) || webContentsId <= 0) throw new Error('Valid preview webContentsId is required');
    const target = webContents.fromId(webContentsId);
    return captureLocalPreview(target, rect);
  });

  ipcMain.handle('vision:prepare-context', async (_event, payload = {}) => buildMultimodalPrompt(payload));

  ipcMain.handle('debugger:launch-isolated', async (_event, { folder, scriptPath, args } = {}) => {
    return getDebugger(folder).launchIsolated(scriptPath, args || []);
  });

  ipcMain.handle('debugger:get-target', async (_event, { folder, targetId } = {}) => {
    return getDebugger(folder).getTarget(targetId);
  });

  ipcMain.handle('debugger:prepare-evaluation', async (_event, { folder, targetId, pid, expression } = {}) => {
    return getDebugger(folder).prepareEvaluation(targetId, pid, expression);
  });

  ipcMain.handle('debugger:stop', async (_event, { folder, targetId } = {}) => {
    return { stopped: getDebugger(folder).stop(targetId) };
  });
}

module.exports = { registerSection7Ipc, getDebugger };
