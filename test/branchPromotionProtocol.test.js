const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('main promotion requires the exact successful cross-platform upgrade checks', () => {
  const workflow = read('.github/workflows/promote-upgrade-to-main.yml');
  for (const check of ['verify', 'dependency-and-release-audit', 'windows-package-smoke', 'Tests ubuntu-latest / Node 24', 'Tests windows-latest / Node 20', 'Tests macos-latest / Node 22']) {
    assert.match(workflow, new RegExp(check.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(workflow, /grep -Fqx .*success/);
  assert.match(workflow, /current_upgrade.*!=.*upgrade_sha/s);
  assert.match(workflow, /git push origin "\$upgrade_sha:refs\/heads\/main"/);
  assert.doesNotMatch(workflow, /--force|-f\b/);
});

test('branch integrity rejects main-only commits and divergence', () => {
  const workflow = read('.github/workflows/branch-integrity.yml');
  assert.match(workflow, /git merge-base --is-ancestor "\$main_sha" "\$upgrade_sha"/);
  assert.match(workflow, /main contains work that was not promoted from upgrade/);
});
