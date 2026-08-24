const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const PINNED_CRUCIBLE_REF = '0759b67985766f974bc5c3d0ded0dc7f87f2b9a0';

test('Crucible integration is external, immutable, and least privilege', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'the-crucible.yml'), 'utf8');
  const references = [...workflow.matchAll(/The-Crucible[^\s@]*@([0-9a-f]{40})|core_ref:\s*([0-9a-f]{40})/g)]
    .map((match) => match[1] || match[2]);

  assert.deepEqual(references, [PINNED_CRUCIBLE_REF, PINNED_CRUCIBLE_REF]);
  assert.match(workflow, /permissions:\s*\n\s*contents: read\s*\n\s*pull-requests: read/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|secrets:\s*inherit/);
  assert.match(workflow, /name: The Crucible[\s\S]*config_path: \.thecrucible\.json/);
});

test('Crucible configuration keeps execution bounded and reports through one gate', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, '.thecrucible.json'), 'utf8'));
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.project.projectId, 'nexus');
  assert.deepEqual(config.workload, { workers: 1, cycles: 1, timeoutMinutes: 30 });
  assert.equal(config.security.enabled, true);
  assert.equal(config.commands.prepare[0].run, 'npm');
  assert.ok(config.commands.verify.every((command) => command.run === 'npm'));
  assert.deepEqual(config.authenticity.claims[0], {
    name: 'Crucible boundary is pinned and least privilege',
    run: 'node',
    args: ['--test', 'test/crucibleIntegration.test.js'],
  });
  assert.match(config.$schema, new RegExp(PINNED_CRUCIBLE_REF));
});

test('Nexus does not vendor or install The Crucible at application runtime', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.['the-crucible'], undefined);
  assert.equal(pkg.devDependencies?.['the-crucible'], undefined);
  assert.equal((pkg.build?.files || []).some((file) => /crucible/i.test(file)), false);
});
