const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptVault, decryptVault } = require('../accountVault');

test('account vault encrypts and decrypts without exposing secret values', () => {
  const payload = { schemaVersion: 1, apiKeys: { openaiKey: 'sk-private-example' }, preferences: { example: 'yes' } };
  const encrypted = encryptVault(payload, 'a strong example passphrase');
  assert.equal(encrypted.includes('sk-private-example'), false);
  assert.deepEqual(decryptVault(encrypted, 'a strong example passphrase'), payload);
});

test('account vault rejects the wrong passphrase and short passphrases', () => {
  const encrypted = encryptVault({ schemaVersion: 1 }, 'correct horse battery staple');
  assert.throws(() => decryptVault(encrypted, 'wrong password long enough'), /could not be unlocked/);
  assert.throws(() => encryptVault({}, 'too short'), /at least 12/);
});

test('cloud clients keep the vault private and identifiable', () => {
  const github = require('fs').readFileSync(require.resolve('../githubClient'), 'utf8');
  const drive = require('fs').readFileSync(require.resolve('../googleDriveClient'), 'utf8');
  assert.match(github, /public: false/);
  assert.match(github, /Nexus Account Vault \(encrypted\)/);
  assert.match(drive, /NexusAccountVault/);
  assert.match(drive, /appProperties/);
});

test('OAuth sessions and executable plug-ins are not part of the portable secret allowlist', () => {
  const main = require('fs').readFileSync(require.resolve('../main'), 'utf8');
  const allowlist = main.match(/const ACCOUNT_VAULT_SECRET_KEYS = \[([^\]]+)\]/)?.[1] || '';
  assert.doesNotMatch(allowlist, /githubToken|googleAccessToken|googleRefreshToken/);
  assert.match(main, /id: String\(item\.id/);
  assert.doesNotMatch(main.match(/const plugins = Array[\s\S]*?: \[\];/)?.[0] || '', /pluginRoot|sourceCode|executable/);
});
