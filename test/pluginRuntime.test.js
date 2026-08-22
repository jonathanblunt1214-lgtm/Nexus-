const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PluginRuntime } = require('../pluginRuntime');

function makePlugin(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-plugin-runtime-'));
  fs.writeFileSync(path.join(root, 'index.js'), source, 'utf8');
  return root;
}

const manifest = { id:'demo.plugin', name:'Demo', version:'1.0.0', entry:'index.js', capabilities:['ui:slot'], slots:['sidebar'] };

test('loads, activates, and invokes declared slots without Node globals', async () => {
  const root = makePlugin(`register({ slots: { sidebar: (payload) => ({ echo: payload.value, hasProcess: typeof process !== 'undefined', hasRequire: typeof require !== 'undefined' }) } });`);
  const runtime = new PluginRuntime();
  runtime.load({ manifest, pluginRoot: root });
  await runtime.activate(manifest.id);
  const result = await runtime.invokeSlot(manifest.id, 'sidebar', { value:'ok' });
  assert.deepEqual(result, { echo:'ok', hasProcess:false, hasRequire:false });
  assert.equal(runtime.health(manifest.id).status, 'HEALTHY');
});

test('rejects undeclared slots and capability calls', async () => {
  const root = makePlugin(`register({ slots: { 'status-panel': () => 'x' } });`);
  const runtime = new PluginRuntime();
  assert.throws(() => runtime.load({ manifest, pluginRoot: root }), /undeclared slot/);

  const root2 = makePlugin(`register({ onActivate: async () => nexus.call('workspace:read', {}) });`);
  const runtime2 = new PluginRuntime({ capabilityHandlers: { 'workspace:read': async () => 'ok' } });
  runtime2.load({ manifest, pluginRoot: root2 });
  await assert.rejects(() => runtime2.activate(manifest.id), /capability denied/);
});
