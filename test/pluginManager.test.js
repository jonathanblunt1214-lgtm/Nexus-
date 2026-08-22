const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PluginManager } = require('../pluginManager');

function createProjectWithPlugin() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-plugin-manager-'));
  const pluginRoot = path.join(projectRoot, '.nexus', 'plugins', 'demo');
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'nexus.plugin.json'), JSON.stringify({
    id:'demo.plugin', name:'Demo', version:'1.0.0', apiVersion:1, entry:'index.js', capabilities:['ui:slot'], slots:['sidebar']
  }), 'utf8');
  fs.writeFileSync(path.join(pluginRoot, 'index.js'), `register({ slots: { sidebar: (payload) => ({ label: 'demo', input: payload.input }) } });`, 'utf8');
  return projectRoot;
}

test('discovers, enables, invokes, health-checks, and disables a local development plugin', async () => {
  const projectRoot = createProjectWithPlugin();
  const manager = new PluginManager({ projectRoot, requireSigned:true, allowUnsignedDevelopment:true });
  const discovered = manager.discover();
  assert.equal(discovered[0].status, 'DISCOVERED');
  const active = await manager.enable('demo.plugin');
  assert.equal(active.status, 'ACTIVE');
  assert.deepEqual(manager.listSlots(), [{ slot:'sidebar', pluginIds:['demo.plugin'] }]);
  const output = await manager.invokeSlot('sidebar', { input:7 });
  assert.deepEqual(output, [{ pluginId:'demo.plugin', ok:true, value:{ label:'demo', input:7 } }]);
  assert.equal(manager.health()[0].runtime.status, 'HEALTHY');
  const disabled = await manager.disable('demo.plugin');
  assert.equal(disabled.status, 'DISABLED');
  const ledger = fs.readFileSync(path.join(projectRoot, '.nexus', 'plugin-audit.jsonl'), 'utf8');
  assert.match(ledger, /PLUGIN_DISCOVERED/);
  assert.match(ledger, /PLUGIN_DISABLED/);
});

test('production-style discovery rejects unsigned plugins', () => {
  const projectRoot = createProjectWithPlugin();
  const manager = new PluginManager({ projectRoot, requireSigned:true, allowUnsignedDevelopment:false });
  const discovered = manager.discover();
  assert.equal(discovered[0].status, 'REJECTED');
  assert.match(discovered[0].error, /signature is required/);
});
