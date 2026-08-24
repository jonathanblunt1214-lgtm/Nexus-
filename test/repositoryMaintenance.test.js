const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { auditRepository } = require('../scripts/repositoryClutterAudit');
const { maintainRepository } = require('../scripts/repositoryMaintenance');

function git(root, args) { return execFileSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true }).trim(); }

test('daily audit detects tracked clutter and passes a clean repository', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-clutter-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Nexus Test']);
  git(root, ['config', 'user.email', 'nexus@example.test']);
  fs.writeFileSync(path.join(root, 'app.js'), 'module.exports = true;\n');
  git(root, ['add', 'app.js']);
  assert.equal(auditRepository({ root }).findings.length, 0);
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist', 'bundle.js'), 'generated\n');
  git(root, ['add', '-f', 'dist/bundle.js']);
  assert.match(auditRepository({ root }).findings.map((item) => item.type).join(' '), /generated or temporary path/);
});

test('weekly maintenance verifies and repacks without changing branch history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-maintenance-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Nexus Test']);
  git(root, ['config', 'user.email', 'nexus@example.test']);
  fs.writeFileSync(path.join(root, 'app.js'), 'one\n');
  git(root, ['add', 'app.js']);
  git(root, ['commit', '-m', 'fixture']);
  const before = git(root, ['rev-parse', 'HEAD']);
  maintainRepository({ root });
  assert.equal(git(root, ['rev-parse', 'HEAD']), before);
  assert.equal(git(root, ['status', '--porcelain']), '');
});

test('scheduled maintenance checks both branches daily and runs The Crucible weekly', () => {
  const root = path.resolve(__dirname, '..');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'repository-maintenance.yml'), 'utf8');
  const crucible = fs.readFileSync(path.join(root, 'scripts', 'releaseStressGate.js'), 'utf8');
  assert.match(workflow, /cron: '17 3 \* \* \*'/);
  assert.match(workflow, /cron: '47 4 \* \* 0'/);
  assert.match(workflow, /ref: \[main, Development-branch\]/);
  assert.match(workflow, /npm run repository:maintain[\s\S]*npm run release:crucible/);
  assert.match(crucible, /repositoryClutterAudit\.js/);
});
