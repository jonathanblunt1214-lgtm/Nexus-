const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('main promotion requires the exact successful cross-platform development checks', () => {
  const workflow = read('.github/workflows/promote-development-to-main.yml');
  const promotion = read('scripts/promoteTestedDevelopment.js');
  for (const check of ['The Crucible', 'dependency-and-release-audit', 'windows-package-smoke']) {
    assert.match(promotion, new RegExp(check.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(promotion, /\['ubuntu-latest','windows-latest','macos-latest'\]/);
  assert.match(promotion, /\[20,22,24\]/);
  assert.match(promotion, /`Tests \$\{os\} \/ Node \$\{node\}`/);
  assert.match(workflow, /node scripts\/promoteTestedDevelopment\.js/);
  const crucibleWorkflow = read('.github/workflows/the-crucible.yml');
  assert.match(crucibleWorkflow, /^name: The Crucible/);
  assert.match(crucibleWorkflow, /jonathanblunt1214-lgtm\/The-Crucible\/\.github\/workflows\/the-crucible\.yml@/);
  assert.match(promotion, /execFileSync\(process\.execPath, \['scripts\/releaseStressGate\.js'\]/);
  assert.match(promotion, /currentDevelopment !== developmentSha/);
  assert.match(promotion, /developmentSha}:refs\/heads\/main/);
  assert.doesNotMatch(`${workflow}\n${promotion}`, /--force|-f\b/);
});

test('failed promotion remediates only on development and retries all gates', () => {
  const workflow = read('.github/workflows/promote-development-to-main.yml');
  const promotion = read('scripts/promoteTestedDevelopment.js');
  const remediation = read('scripts/remediateDevelopmentForPromotion.js');
  assert.match(workflow, /actions: write/);
  assert.match(promotion, /remediateDevelopmentForPromotion\.js/);
  assert.match(promotion, /Apply deterministic promotion repairs/);
  assert.match(promotion, /HEAD:Development-branch/);
  assert.match(promotion, /dispatch\('the-crucible\.yml'\)/);
  assert.match(promotion, /dispatch\('release-audit\.yml'\)/);
  assert.match(promotion, /waitForChecks\(developmentSha\)/);
  assert.match(remediation, /proposeCheckerFix/);
  assert.match(remediation, /proposal\.after.*diagnostics/);
  assert.match(remediation, /NEXUS_REPAIR_REF/);
});

test('branch integrity accepts ancestry or an exact squash-promoted Development tree', () => {
  const workflow = read('.github/workflows/branch-integrity.yml');
  assert.match(workflow, /git merge-base --is-ancestor "\$main_sha" "\$development_sha"/);
  assert.match(workflow, /main_tree=.*\$\{main_sha\}\^\{tree\}/);
  assert.match(workflow, /git rev-list "\$development_sha"/);
  assert.match(workflow, /\$\{development_commit\}\^\{tree\}/);
  assert.match(workflow, /main contains a tree that never existed in Development-branch/);
});
