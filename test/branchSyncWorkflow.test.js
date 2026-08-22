const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'sync-upgrade-branch.yml'), 'utf8');

test('main pushes automatically fast-forward the upgrade branch', () => {
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.match(workflow, /permissions:\s*\n\s*contents: write/);
  assert.match(workflow, /git push origin "\$main_sha:refs\/heads\/upgrade\/nexus-overhaul"/);
});

test('branch synchronization refuses to destroy divergent upgrade work', () => {
  assert.match(workflow, /git merge-base --is-ancestor "\$upgrade_sha" "\$main_sha"/);
  assert.match(workflow, /Refusing to force-push or discard it/);
  assert.doesNotMatch(workflow, /git push[^\n]*(--force|-f\b)/);
});

test('branch synchronization is serialized and can be run manually', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: sync-upgrade-branch/);
  assert.match(workflow, /cancel-in-progress: false/);
});
