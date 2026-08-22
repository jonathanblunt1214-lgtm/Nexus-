const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSenderValidator, secureIpcHandlers } = require('../ipcSecurity');

test('IPC sender validation only accepts the packaged Nexus renderer', () => {
  const root = path.join('C:', 'Nexus');
  const validate = createSenderValidator(root);
  const trusted = pathToFileURL(path.join(root, 'index.html')).href;
  assert.equal(validate({ senderFrame: { url: trusted } }), true);
  assert.throws(() => validate({ senderFrame: { url: 'https://attacker.example/' } }), /untrusted renderer/);
});

test('all registered invoke handlers pass through sender validation', () => {
  let wrapped;
  const ipcMain = { handle: (_channel, listener) => { wrapped = listener; } };
  secureIpcHandlers(ipcMain, () => { throw new Error('denied'); });
  ipcMain.handle('dangerous', () => 'ran');
  assert.throws(() => wrapped({}), /denied/);
});

test('main window is sandboxed and remote permissions are denied by default', () => {
  const fs = require('node:fs');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /contextIsolation: true,[\s\S]*?nodeIntegration: false,[\s\S]*?sandbox: true/);
  assert.match(main, /setPermissionRequestHandler\([\s\S]*?callback\(false\)/);
  assert.match(main, /setPermissionCheckHandler\(\(\) => false\)/);
});

test('Workspace Trust is revocable and gates execution, deploys, and Git writes', () => {
  const fs = require('node:fs');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  assert.match(main, /workspace-trust:set/);
  assert.match(main, /workspace-trust:revoke/);
  assert.match(main, /requireWorkspacePermission\(folder, 'commands'\)/);
  assert.match(main, /requireWorkspacePermission\(folder, 'git-write'\)/);
  assert.match(main, /requireWorkspacePermission\(folder, 'deploy'\)/);
  assert.match(renderer, /Review permissions/);
  assert.match(renderer, /Workspace Trust revoked/);
});
