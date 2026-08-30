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
    'plugins:crucible-provision','plugins:disable','plugins:enable','plugins:health','plugins:import','plugins:invoke-slot','plugins:list','plugins:marketplace-install','plugins:marketplace-list','plugins:marketplace-publish','plugins:scan','plugins:slots'
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

test('provisions Crucible v0.3.0 against the authorized real workspace and reaches secure readiness', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-crucible-provision-'));
  const handlers = new Map();
  const registered = registerSection8Ipc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, isAuthorizedProjectRoot: (candidate) => candidate === fs.realpathSync(root) });
  try {
    const result = await handlers.get('plugins:crucible-provision')(null, { projectRoot: root });
    assert.equal(result.ok, true);
    assert.equal(result.ready, true);
    assert.equal(result.plugin.version, '0.3.0');
    assert.equal(result.plugin.status, 'ACTIVE');
    assert.equal(result.readiness.configuration.projectId, result.identity.projectId);
    const configurationPath = path.join(root, 'governingDocuments', '.crucible-learning', result.identity.projectId, 'configuration.json');
    const configuration = fs.readFileSync(configurationPath, 'utf8');
    assert.match(configuration, /masterKeySha256/);
    assert.doesNotMatch(configuration, /PRIVATE KEY/);
  } finally {
    const manager = registered.managers.get(fs.realpathSync(root));
    if (manager?.runtime.instances.has('the-crucible')) await manager.disable('the-crucible');
  }
});
