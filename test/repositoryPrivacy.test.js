const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('every push is locally gated against private Nexus account data', () => {
  const pkg = require('../package.json');
  const hook = fs.readFileSync(require.resolve('../.githooks/pre-push'), 'utf8');
  const workflow = fs.readFileSync(require.resolve('../.github/workflows/section0-stability.yml'), 'utf8');
  const stressGate = fs.readFileSync(require.resolve('../scripts/releaseStressGate'), 'utf8');
  assert.equal(pkg.scripts['privacy:verify'], 'node scripts/verifyRepositoryPrivacy.js');
  assert.equal(pkg.scripts.prepare, 'node scripts/installGitHooks.js');
  assert.match(hook, /verifyRepositoryPrivacy\.js/);
  assert.match(hook, /inventory:verify/);
  assert.match(workflow, /npm run release:crucible/);
  assert.match(stressGate, /verifyRepositoryPrivacy\.js/);
});

test('privacy gate covers credentials personal paths emails and account-state files', () => {
  const source = fs.readFileSync(require.resolve('../scripts/verifyRepositoryPrivacy'), 'utf8');
  for (const marker of ['GitHub credential', 'private key', 'personal Windows user path', 'personal Google Drive path', 'personal email address', 'private user-state file']) assert.match(source, new RegExp(marker));
  assert.doesNotMatch(source, /console\.error\(`[^`]*match\[0\]/);
});
