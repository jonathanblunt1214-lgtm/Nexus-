const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSection7Ipc } = require('../section7Ipc');

test('Section 7 IPC registers only narrow vision/debugger handlers', () => {
  const names = [];
  const ipcMain = { handle: (name) => names.push(name) };
  const webContents = { fromId: () => null };
  registerSection7Ipc({ ipcMain, webContents });
  assert.deepEqual(names.sort(), [
    'debugger:get-target',
    'debugger:launch-isolated',
    'debugger:prepare-evaluation',
    'debugger:stop',
    'vision:capture-preview',
    'vision:prepare-context',
  ]);
});
