const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const PINNED_CRUCIBLE_REF = '9d52a29bade03027cb523dd3aa0dd629cecb31a1';

test('AI conflict governance has a mandatory auditable ledger', () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'AI-CONFLICTS.json'), 'utf8'));
  assert.equal(ledger.schemaVersion, 1);
  assert.ok(Array.isArray(ledger.conflicts));
});

test('Crucible integration is external, immutable, and least privilege', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'the-crucible.yml'), 'utf8');
  const references = [...workflow.matchAll(/The-Crucible[^\s@]*@([0-9a-f]{40})|core_ref:\s*([0-9a-f]{40})/g)]
    .map((match) => match[1] || match[2]);

  assert.deepEqual(references, [PINNED_CRUCIBLE_REF, PINNED_CRUCIBLE_REF]);
  assert.match(workflow, /^permissions:\s*\n\s*contents: read\s*\n\s*issues: write\s*\n\s*pull-requests: read/m);
  assert.doesNotMatch(workflow, /pull-requests: write|secrets:\s*inherit/);

  const repairJob = workflow.match(/\n  autonomous-repair:\n([\s\S]*)$/)?.[1] || '';
  assert.ok(repairJob, 'autonomous repair job must remain present');
  assert.match(repairJob, /permissions:\s*\n\s*contents: write\s*\n\s*actions: write\s*\n\s*models: read/);
  assert.equal((workflow.match(/contents: write/g) || []).length, 1, 'write access must stay isolated to the repair job');
  assert.match(repairJob, /github\.ref == 'refs\/heads\/Development-branch'/);
  assert.match(repairJob, /needs\.crucible\.result == 'failure'/);

  assert.match(workflow, /name: The Crucible[\s\S]*config_path: \.thecrucible\.json/);
});

test('Crucible configuration keeps execution bounded and reports through one gate', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, '.thecrucible.json'), 'utf8'));
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.project.projectId, 'nexus');
  assert.equal(config.workload.workers, 1);
  assert.equal(config.workload.cycles, 1);
  assert.equal(config.workload.timeoutMinutes, 30);
  assert.notEqual(config.security.enabled, false);
  assert.equal(config.commands.prepare[0].run, 'npm');
  assert.ok(config.commands.verify.every((command) => command.run === 'npm'));
  assert.ok(config.authenticity.claims.every((claim) => claim.run === 'npm' || claim.run === 'node'));
  assert.ok(config.authenticity.claims.some((claim) => claim.name === 'Crucible boundary is pinned and least privilege'));
  assert.match(config.$schema, new RegExp(PINNED_CRUCIBLE_REF));
});

test('Nexus does not vendor or install The Crucible at application runtime', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.['the-crucible'], undefined);
  assert.equal(pkg.devDependencies?.['the-crucible'], undefined);
  assert.equal((pkg.build?.files || []).some((file) => /crucible/i.test(file)), false);
});
