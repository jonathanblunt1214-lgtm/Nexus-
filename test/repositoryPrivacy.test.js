const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('every push is locally gated against private Nexus account data', () => {
  const pkg = require('../package.json');
  const hook = fs.readFileSync(require.resolve('../.githooks/pre-push'), 'utf8');
  const commitHook = fs.readFileSync(require.resolve('../.githooks/pre-commit'), 'utf8');
  const workflow = fs.readFileSync(require.resolve('../.github/workflows/section0-stability.yml'), 'utf8');
  const stressGate = fs.readFileSync(require.resolve('../scripts/releaseStressGate'), 'utf8');
  assert.equal(pkg.scripts['privacy:verify'], 'node scripts/verifyRepositoryPrivacy.js');
  assert.equal(pkg.scripts.prepare, 'node scripts/installGitHooks.js');
  assert.match(hook, /privacyRetryGate\.js/);
  assert.match(commitHook, /privacyRetryGate\.js --allow-repaired/);
  assert.match(hook, /inventory:verify/);
  assert.match(workflow, /npm run release:crucible/);
  assert.match(stressGate, /privacyRetryGate\.js/);
});

test('privacy scrubber redacts recognized values without printing or preserving them', () => {
  const { scrubText } = require('../scripts/scrubRepositoryPrivacy');
  const token = ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_');
  const input = `token=${token} path=C:\\Users\\private-person\\project email=[REDACTED_EMAIL]`;
  const scrubbed = scrubText(input);
  assert.doesNotMatch(scrubbed, /abcdefghijklmnopqrstuvwxyz|private-person|private-domain/);
  assert.match(scrubbed, /REDACTED_GITHUB_TOKEN/);
  assert.match(scrubbed, /USER_HOME/);
  assert.match(scrubbed, /REDACTED_EMAIL/);
});

test('failed privacy verification invokes the scrubber before retrying', () => {
  const retry = fs.readFileSync(require.resolve('../scripts/privacyRetryGate'), 'utf8');
  const remediation = fs.readFileSync(require.resolve('../scripts/remediateDevelopmentForPromotion'), 'utf8');
  assert.match(retry, /Running the scrubber and checking again/);
  assert.match(retry, /scrubRepository\(root\)/);
  assert.match(retry, /this push remains blocked/);
  assert.match(remediation, /scrubRepositoryPrivacy\.js/);
});

test('privacy gate covers credentials personal paths emails and account-state files', () => {
  const source = fs.readFileSync(require.resolve('../scripts/verifyRepositoryPrivacy'), 'utf8');
  for (const marker of ['GitHub credential', 'private key', 'personal Windows user path', 'personal Google Drive path', 'personal email address', 'private user-state file']) assert.match(source, new RegExp(marker));
  assert.doesNotMatch(source, /console\.error\(`[^`]*match\[0\]/);
});
