const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
const languageServices = fs.readFileSync(path.join(root, 'officialLanguageServers.js'), 'utf8');

test('coding provider UI hides saved secrets and supports replacement without revealing them', () => {
  assert.match(bootstrap, /syncProviderCardFromState/);
  assert.match(bootstrap, /Boolean\(current\?\.configured\)/);
  assert.match(bootstrap, /Configured · key hidden/);
  assert.match(bootstrap, /data-provider-replace-key/);
  assert.match(bootstrap, /key\.style\.display = 'none'/);
  assert.match(bootstrap, /key\.value = ''/);
});

test('development account provider configuration saves on field changes and clears secret inputs', () => {
  assert.match(bootstrap, /account-provider-auto-status/);
  assert.match(bootstrap, /saveOauthAutomatically/);
  assert.match(bootstrap, /window\.nexus\.oauthConfigure\(payload\)/);
  assert.match(bootstrap, /saveEmailAutomatically/);
  assert.match(bootstrap, /window\.nexus\.emailAccountConfigure/);
  assert.match(bootstrap, /field\.placeholder = 'Configured · hidden'/);
  assert.match(bootstrap, /addEventListener\('change'/);
});

test('auto save and push retries GitHub authentication with the encrypted Nexus connection', () => {
  assert.match(bootstrap, /retryAuthenticatedGithubPush/);
  assert.match(bootstrap, /readStoredGithubToken/);
  assert.match(bootstrap, /safeStorage\.decryptString/);
  assert.match(bootstrap, /GIT_CONFIG_KEY_0:'http\.extraHeader'/);
  assert.match(bootstrap, /GIT_CONFIG_VALUE_0:'Authorization: Basic '/);
  assert.match(bootstrap, /GIT_TERMINAL_PROMPT:'0'/);
  assert.match(bootstrap, /failureDetails\.push/);
  assert.doesNotMatch(bootstrap, /x-access-token:' \+ token \+ '@github\.com/);
});

test('official language services auto-detect commands and Settings hides unnecessary selectors', () => {
  assert.match(languageServices, /function commandOnPath\(command\)/);
  assert.match(languageServices, /configuredSource:'path'/);
  assert.match(languageServices, /autoDetected:detected/);
  assert.match(languageServices, /process\.env\.NEXUS_PSES_PATH/);
  assert.match(bootstrap, /syncLanguageServiceControls/);
  assert.match(bootstrap, /button\.hidden = Boolean\(provider\.configured\)/);
  assert.match(bootstrap, /repeat\(auto-fit, minmax\(150px, 1fr\)\)/);
});
