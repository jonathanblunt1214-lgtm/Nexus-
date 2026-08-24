const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('main promotion requires the exact successful cross-platform upgrade checks', () => {
  const workflow = read('.github/workflows/promote-upgrade-to-main.yml');
  const promotion = read('scripts/promoteTestedUpgrade.js');
  for (const check of ['The Crucible', 'dependency-and-release-audit', 'windows-package-smoke']) {
    assert.match(promotion, new RegExp(check.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(promotion, /\['ubuntu-latest','windows-latest','macos-latest'\]/);
  assert.match(promotion, /\[20,22,24\]/);
  assert.match(promotion, /`Tests \$\{os\} \/ Node \$\{node\}`/);
  assert.match(workflow, /node scripts\/promoteTestedUpgrade\.js/);
  assert.match(read('.github/workflows/section0-stability.yml'), /name: The Crucible[\s\S]*npm run release:crucible/);
  assert.match(read('.github/workflows/section0-stability.yml'), /timeout-minutes: 5/);
  assert.match(promotion, /execFileSync\(process\.execPath, \['scripts\/releaseStressGate\.js'\]/);
  assert.match(promotion, /currentUpgrade !== upgradeSha/);
  assert.match(promotion, /upgradeSha}:refs\/heads\/main/);
  assert.doesNotMatch(`${workflow}\n${promotion}`, /--force|-f\b/);
});

test('failed promotion remediates only on upgrade and retries all gates', () => {
  const workflow = read('.github/workflows/promote-upgrade-to-main.yml');
  const promotion = read('scripts/promoteTestedUpgrade.js');
  const remediation = read('scripts/remediateUpgradeForPromotion.js');
  assert.match(workflow, /actions: write/);
  assert.match(promotion, /remediateUpgradeForPromotion\.js/);
  assert.match(promotion, /Apply deterministic promotion repairs/);
  assert.match(promotion, /HEAD:upgrade\/nexus-overhaul/);
  assert.match(promotion, /dispatch\('section0-stability\.yml'\)/);
  assert.match(promotion, /dispatch\('release-audit\.yml'\)/);
  assert.match(promotion, /waitForChecks\(upgradeSha\)/);
  assert.match(remediation, /proposeCheckerFix/);
  assert.match(remediation, /proposal\.after.*diagnostics/);
  assert.match(remediation, /NEXUS_REPAIR_REF/);
});

test('branch integrity rejects main-only commits and divergence', () => {
  const workflow = read('.github/workflows/branch-integrity.yml');
  assert.match(workflow, /git merge-base --is-ancestor "\$main_sha" "\$upgrade_sha"/);
  assert.match(workflow, /main contains work that was not promoted from upgrade/);
});
