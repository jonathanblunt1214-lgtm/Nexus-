const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'sync-development-branch.yml'), 'utf8');

test('branch-to-branch synchronization is manual and never triggered by a push', () => {
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: write/);
  assert.match(workflow, /ahead_count="\$\(git rev-list --count "\$development_sha\.\.\$main_sha"\)"/);
  assert.match(workflow, /if \[ "\$ahead_count" -lt 100 \]/);
  assert.match(workflow, /Waiting for 100 before publishing and synchronizing/);
  assert.match(workflow, /git push origin "\$main_sha:refs\/heads\/Development-branch"/);
});

test('a versioned automatic update is published before development synchronization', () => {
  assert.match(workflow, /npm version patch --no-git-tag-version/);
  assert.match(workflow, /release-notes\.md/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/release\.yml/);
  assert.match(workflow, /if: needs\.publish-update\.result == 'success'/);

  const publishJob = workflow.indexOf('publish-update:');
  const synchronizeJob = workflow.indexOf('synchronize-development:');
  assert.ok(publishJob >= 0 && synchronizeJob > publishJob);
});

test('branch synchronization waits at 99 commits and proceeds at 100', () => {
  const thresholdMatch = workflow.match(/"\$ahead_count" -lt (\d+)/);
  assert.ok(thresholdMatch);

  const threshold = Number(thresholdMatch[1]);
  assert.equal(99 < threshold, true);
  assert.equal(100 < threshold, false);
});

test('branch synchronization refuses to destroy divergent development work', () => {
  assert.match(workflow, /git merge-base --is-ancestor "\$development_sha" "\$main_sha"/);
  assert.match(workflow, /Refusing to force-push or discard it/);
  assert.doesNotMatch(workflow, /git push[^\n]*(--force|-f\b)/);
});

test('branch synchronization is serialized and can be run manually', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: sync-development-branch/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('ordinary pushes validate without branch movement except bounded failed-Crucible repair', () => {
  const integrity = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'branch-integrity.yml'), 'utf8');
  const crucible = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'the-crucible.yml'), 'utf8');
  const audit = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release-audit.yml'), 'utf8');
  for (const gate of [integrity, crucible, audit]) assert.match(gate, /push:/);
  for (const gate of [integrity, audit]) assert.doesNotMatch(gate, /git push/);

  const repairJob = crucible.match(/\r?\n  autonomous-repair:\r?\n([\s\S]*)$/)?.[1] || '';
  assert.ok(repairJob, 'Crucible branch writes must be isolated to autonomous-repair');
  assert.match(repairJob, /needs\.crucible\.result == 'failure'/);
  assert.match(repairJob, /github\.ref == 'refs\/heads\/Development-branch'/);
  assert.match(repairJob, /git push origin HEAD:Development-branch/);
  assert.doesNotMatch(repairJob, /refs\/heads\/main|git push[^\n]*(--force|-f\b)/);
  assert.equal((crucible.match(/git push/g) || []).length, 1, 'only the bounded autonomous repair may push');
});
