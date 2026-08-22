const path = require('path');
const { captureLocalPreview, buildMultimodalPrompt } = require('./visualContext');
const { RuntimeDebugger } = require('./runtimeDebugger');
const { DebugAdapterSession } = require('./debugAdapter');

const debuggers = new Map();
const adapters = new Map();

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

function registerSection7Ipc({ ipcMain, webContents, authorizeRuntime = () => true }) {
  ipcMain.handle('vision:capture-preview', async (_event, { webContentsId, rect } = {}) => {
    if (!Number.isInteger(webContentsId) || webContentsId <= 0) throw new Error('Valid preview webContentsId is required');
    const target = webContents.fromId(webContentsId);
    return captureLocalPreview(target, rect);
  });

  ipcMain.handle('vision:prepare-context', async (_event, payload = {}) => buildMultimodalPrompt(payload));

  ipcMain.handle('debugger:launch-isolated', async (_event, { folder, scriptPath, args } = {}) => {
    if (!authorizeRuntime(folder)) throw new Error('Workspace Trust must allow project commands before debugging.');
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
  ipcMain.handle('debugger:connect', async (_event, { folder, targetId } = {}) => getDebugger(folder).connect(targetId));
  ipcMain.handle('debugger:attach-local', async (_event, { folder, pid, debugUrl } = {}) => {
    if (!authorizeRuntime(folder)) throw new Error('Workspace Trust must allow project commands before debugging.');
    return getDebugger(folder).attachLocal(pid, debugUrl);
  });
  ipcMain.handle('debugger:snapshot', async (_event, { folder, targetId } = {}) => getDebugger(folder).snapshot(targetId));
  ipcMain.handle('debugger:set-breakpoint', async (_event, { folder, targetId, url, line, column, condition } = {}) => getDebugger(folder).setBreakpoint(targetId, url, line, column, condition));
  ipcMain.handle('debugger:remove-breakpoint', async (_event, { folder, targetId, breakpointId } = {}) => getDebugger(folder).removeBreakpoint(targetId, breakpointId));
  ipcMain.handle('debugger:control', async (_event, { folder, targetId, action } = {}) => getDebugger(folder).control(targetId, action));
  ipcMain.handle('debugger:exception-mode', async (_event, { folder, targetId, mode } = {}) => getDebugger(folder).setExceptionMode(targetId, mode));
  ipcMain.handle('debugger:properties', async (_event, { folder, targetId, objectId } = {}) => getDebugger(folder).properties(targetId, objectId));
  ipcMain.handle('debugger:evaluate', async (_event, { folder, targetId, callFrameId, expression } = {}) => getDebugger(folder).evaluate(targetId, callFrameId, expression));
  ipcMain.handle('debugger:dap-start', async (_event, { folder, command, args, adapterId, configuration } = {}) => {
    if (!authorizeRuntime(folder)) throw new Error('Workspace Trust must allow project commands before debugging.');
    const session = new DebugAdapterSession({ workspaceRoot: folder, command, args });
    adapters.set(session.id, session);
    await session.initialize(adapterId);
    await session.launch(configuration || {});
    return session.snapshot();
  });
  ipcMain.handle('debugger:dap-request', async (_event, { sessionId, method, args } = {}) => {
    const session = adapters.get(sessionId);
    if (!session) throw new Error('Unknown debug adapter session');
    const allowed = new Set(['threads', 'stackTrace', 'scopes', 'variables', 'evaluate', 'setBreakpoints', 'control']);
    if (!allowed.has(method)) throw new Error('Unsupported debug adapter request');
    if (method === 'threads') return session.threads();
    if (method === 'stackTrace') return session.stackTrace(args.threadId);
    if (method === 'scopes') return session.scopes(args.frameId);
    if (method === 'variables') return session.variables(args.variablesReference);
    if (method === 'evaluate') return session.evaluate(args.expression, args.frameId);
    if (method === 'setBreakpoints') return session.setBreakpoints(args.source, args.breakpoints || []);
    return session.control(args.action, args.threadId);
  });
  ipcMain.handle('debugger:dap-stop', async (_event, { sessionId } = {}) => { const session = adapters.get(sessionId); if (!session) return { stopped: false }; session.stop(); adapters.delete(sessionId); return { stopped: true }; });
}

module.exports = { registerSection7Ipc, getDebugger };
