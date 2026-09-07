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

test('AI Collaboration coding-provider slot owns coding requests instead of native fallback', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ai-collab-')));
  const comparable = (value) => process.platform === 'win32' ? String(value).toLowerCase() : String(value);
  const handlers = new Map();
  let nativeCalls = 0;
  const record = {
    id: 'ai-collaboration',
    manifest: { id: 'ai-collaboration', name: 'AI Collaboration', slots: ['coding-provider'] },
    status: 'ACTIVE',
  };
  const manager = {
    registry: new Map([[record.id, record]]),
    discover: () => [],
    list: () => [{ id: record.id, name: record.manifest.name, status: record.status }],
    enable: async () => ({ id: record.id, name: record.manifest.name, status: 'ACTIVE' }),
    disable: async () => ({}),
    listSlots: () => [],
    health: () => [],
    invokeSlot: async () => [],
    slotPayloadDecorator: null,
    audit: () => {},
    runtime: {
      invokeSlot: async (pluginId, slot, payload) => ({ ok: true, source: pluginId, slot, channel: payload.channel, text: 'plugin-owned' }),
    },
  };
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  registerSection8Ipc({ ipcMain, isAuthorizedProjectRoot: (candidate) => comparable(candidate) === comparable(root), managerFactory: () => manager });
  ipcMain.handle('coding-models:ask', async () => { nativeCalls += 1; return { ok: true, text: 'native' }; });
  const result = await handlers.get('coding-models:ask')(null, { folder: root, prompt: 'build it' });
  assert.equal(result.text, 'plugin-owned');
  assert.equal(result.source, 'ai-collaboration');
  assert.equal(nativeCalls, 0);
});

test('Crucible save hook auto-injects once through existing audited project-actions API', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-crucible-save-')));
  const calls = [];
  const record = {
    id: 'the-crucible',
    manifest: { id: 'the-crucible', name: 'The Crucible', slots: ['project-actions'] },
    status: 'ACTIVE',
  };
  const manager = {
    registry: new Map([[record.id, record]]),
    discover: () => [],
    list: () => [{ id: record.id, name: record.manifest.name, status: record.status }],
    enable: async () => ({ id: record.id, name: record.manifest.name, status: 'ACTIVE' }),
    disable: async () => ({}),
    listSlots: () => [],
    health: () => [],
    invokeSlot: async () => [],
    slotPayloadDecorator: (_pluginId, _slot, payload) => payload,
    audit: () => {},
    runtime: {
      invokeSlot: async (_pluginId, _slot, payload) => {
        calls.push(payload.actionId);
        if (payload.actionId === 'crucible-auto-inject-preview') return { ok: true, writes: [{ path: 'governingDocuments/CRUCIBLE-REFERENCES.json', exists: false }] };
        if (payload.actionId === 'crucible-auto-inject') return { ok: true, written: ['governingDocuments/CRUCIBLE-REFERENCES.json'] };
        return { ok: true };
      },
    },
  };
  const registered = registerSection8Ipc({ ipcMain: { handle: () => {} }, isAuthorizedProjectRoot: (candidate) => candidate === root, managerFactory: () => manager });
  const result = await registered.runCrucibleSaveHook(root, { filePath: path.join(root, 'src', 'app.js') });
  assert.equal(result.invoked, true);
  assert.equal(result.injected, true);
  assert.deepEqual(calls, ['crucible-auto-inject-preview', 'crucible-auto-inject']);
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
