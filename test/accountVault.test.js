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

test('air-gapped vault handlers use only explicit local file dialogs and encrypted envelopes', () => {
  const fs = require('fs');
  const main = fs.readFileSync(require.resolve('../main'), 'utf8');
  const start = main.indexOf("ipcMain.handle('account-vault:airgap-export'");
  const end = main.indexOf("ipcMain.handle('drive:list'", start);
  const handlers = main.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(handlers, /showSaveDialog/);
  assert.match(handlers, /showOpenDialog/);
  assert.match(handlers, /encryptVault/);
  assert.match(handlers, /decryptVault/);
  assert.doesNotMatch(handlers, /githubClient|googleDriveClient|firebaseAccountClient|fetch\(|saveEncryptedAccountVault/);
});

test('Settings never mislabels encrypted cloud copies as air-gapped storage', () => {
  const fs = require('fs');
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.match(html, /Encrypted cloud backup:[\s\S]*not air-gapped/);
  assert.match(html, /Local Air-Gapped Vault/);
  assert.match(html, /Disconnect and securely store the drive/);
});

test('Nexus profiles and creative-app preferences are saved and included in the encrypted vault', () => {
  const fs = require('fs'); const main = fs.readFileSync(require.resolve('../main'), 'utf8'); const preload = fs.readFileSync(require.resolve('../preload'), 'utf8'); const renderer = fs.readFileSync(require.resolve('../renderer'), 'utf8'); const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.match(main, /function sanitizeUserProfile/);
  assert.match(main, /profile:sanitizeUserProfile\(cfg\.nexusUserProfile/);
  assert.match(main, /account-profile:save/);
  assert.match(preload, /userProfileSave/);
  for (const preference of ['nexus_ui_density','nexus_reduced_motion','nexus_editor_font_size','nexus_editor_tab_size','nexus_editor_word_wrap','nexus_format_on_save']) assert.ok(main.includes(preference) && renderer.includes(preference));
  assert.match(renderer, /codeEditorCM\.setOption\('lineWrapping'/);
  assert.match(html, /Nexus Profile/);
  const builder = main.match(/function buildAccountVaultPayload[\s\S]*?\n}/)?.[0] || '';
  assert.doesNotMatch(builder, /nexus_projects|projectPath/);
  const serializedReturn = builder.split('\n').find((line) => line.includes('return { schemaVersion')) || '';
  assert.doesNotMatch(serializedReturn, /githubToken|googleAccessToken|googleRefreshToken|wordpressAccessToken/);
});

test('executable plug-ins are optionally account-linked by immutable private package references', () => {
  const fs = require('fs'); const main = fs.readFileSync(require.resolve('../main'), 'utf8'); const renderer = fs.readFileSync(require.resolve('../renderer'), 'utf8'); const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.match(main, /accountLinked:item\.accountLinked === true/);
  assert.match(main, /marketplaceId:item\.accountLinked/);
  assert.match(main, /packageDigest:item\.accountLinked/);
  assert.match(renderer, /pluginsMarketplacePublish\(folder, pluginId, 'private'\)/);
  assert.match(renderer, /item\.packageDigest !== reference\.packageDigest/);
  assert.match(renderer, /pluginsMarketplaceInstall\(folder, reference\.marketplaceId\)/);
  assert.match(renderer, /installed disabled/);
  assert.match(html, /Restore account-linked plug-ins/);
  const serializedReturn = (main.match(/function buildAccountVaultPayload[\s\S]*?\n}/)?.[0] || '').split('\n').find((line) => line.includes('return { schemaVersion')) || '';
  assert.doesNotMatch(serializedReturn, /pluginRoot|sourceCode|executable|packageContent/);
});
