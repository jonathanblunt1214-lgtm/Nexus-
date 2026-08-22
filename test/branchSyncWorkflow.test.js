const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'sync-upgrade-branch.yml'), 'utf8');

test('main pushes evaluate whether the upgrade branch reached the synchronization threshold', () => {
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.match(workflow, /permissions:\s*\n\s*contents: write/);
  assert.match(workflow, /ahead_count="\$\(git rev-list --count "\$upgrade_sha\.\.\$main_sha"\)"/);
  assert.match(workflow, /if \[ "\$ahead_count" -lt 100 \]/);
  assert.match(workflow, /Waiting for 100 before publishing and synchronizing/);
  assert.match(workflow, /git push origin "\$main_sha:refs\/heads\/upgrade\/nexus-overhaul"/);
});

test('a versioned automatic update is published before upgrade synchronization', () => {
  assert.match(workflow, /npm version patch --no-git-tag-version/);
  assert.match(workflow, /release-notes\.md/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/release\.yml/);
  assert.match(workflow, /if: needs\.publish-update\.result == 'success'/);

  const publishJob = workflow.indexOf('publish-update:');
  const synchronizeJob = workflow.indexOf('synchronize-upgrade:');
  assert.ok(publishJob >= 0 && synchronizeJob > publishJob);
});

test('branch synchronization waits at 99 commits and proceeds at 100', () => {
  const thresholdMatch = workflow.match(/"\$ahead_count" -lt (\d+)/);
  assert.ok(thresholdMatch);

  const threshold = Number(thresholdMatch[1]);
  assert.equal(99 < threshold, true);
  assert.equal(100 < threshold, false);
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
