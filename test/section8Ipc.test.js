const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerSection8Ipc, normalizeProjectRoot } = require('../section8Ipc');

test('registers only the intended plugin IPC channels', () => {
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  registerSection8Ipc({
    ipcMain,
    isAuthorizedProjectRoot: () => true,
    managerFactory: () => ({ discover:()=>[], list:()=>[], enable:()=>({}), disable:()=>({}), listSlots:()=>[], health:()=>[], invokeSlot:()=>[] }),
  });
  assert.deepEqual([...handlers.keys()].sort(), [
    'plugins:disable','plugins:enable','plugins:health','plugins:import','plugins:invoke-slot','plugins:list','plugins:marketplace-install','plugins:marketplace-list','plugins:marketplace-publish','plugins:scan','plugins:slots'
  ]);
});

test('normalizes only existing project directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-plugin-ipc-'));
  assert.equal(normalizeProjectRoot(root), fs.realpathSync(root));
  assert.throws(() => normalizeProjectRoot(path.join(root, 'missing')), /existing directory/);
});

test('rejects plugin IPC for a directory that Nexus has not authorized', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-plugin-ipc-denied-'));
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  registerSection8Ipc({
    ipcMain,
    isAuthorizedProjectRoot: () => false,
    managerFactory: () => ({ discover:()=>[] }),
  });
  await assert.rejects(() => handlers.get('plugins:scan')(null, { projectRoot: root }), /not an authorized Nexus workspace/);
});
