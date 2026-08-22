const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { staticBehaviorScan } = require('../pluginSecurityScanner');
const { PluginManager } = require('../pluginManager');

function pluginFolder(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-upload-plugin-'));
  fs.writeFileSync(path.join(root, 'nexus.plugin.json'), JSON.stringify({ id:'screened.demo', name:'Screened Demo', version:'1.0.0', apiVersion:1, entry:'index.js', capabilities:['ui:slot'], slots:['sidebar'] }));
  fs.writeFileSync(path.join(root, 'index.js'), source);
  return root;
}

test('behavior screening blocks shell, credential, ransomware, and executable patterns', () => {
  const root = pluginFolder("const cp = require('child_process'); cp.execSync('powershell'); process.env.SECRET;");
  fs.writeFileSync(path.join(root, 'payload.exe'), 'not actually executable');
  const report = staticBehaviorScan(root);
  assert.equal(report.passed, false);
  assert.ok(report.findings.some((item) => item.rule === 'shell-execution'));
  assert.ok(report.findings.some((item) => item.rule === 'credential-access'));
  assert.ok(report.findings.some((item) => item.rule === 'unsafe-binary'));
});

test('screened uploads install disabled and approval is bound to the exact file digest', async () => {
  const source = pluginFolder("register({ slots: { sidebar: () => ({ label: 'safe' }) } });");
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-screened-project-'));
  const manager = new PluginManager({ projectRoot, requireSigned:true });
  const imported = await manager.importFromFolder(source, { defenderScan: async () => ({ passed:true, engine:'Test Defender' }) });
  assert.equal(imported.ok, true);
  assert.equal(imported.plugin.screened, true);
  assert.equal(imported.plugin.status, 'DISABLED');
  fs.appendFileSync(path.join(projectRoot, '.nexus', 'plugins', 'screened.demo', 'index.js'), '\n// changed after approval');
  const rediscovered = manager.discover().find((item) => item.id === 'screened.demo');
  assert.equal(rediscovered.status, 'REJECTED');
  assert.match(rediscovered.error, /screening approval exists/);
});

test('blocked uploads are never copied into the installed plug-ins directory', async () => {
  const source = pluginFolder("require('child_process').spawn('cmd.exe');");
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-blocked-project-'));
  const manager = new PluginManager({ projectRoot, requireSigned:true });
  const result = await manager.importFromFolder(source, { defenderScan: async () => ({ passed:true, engine:'Test Defender' }) });
  assert.equal(result.blocked, true);
  assert.equal(fs.existsSync(path.join(projectRoot, '.nexus', 'plugins', 'screened.demo')), false);
});
