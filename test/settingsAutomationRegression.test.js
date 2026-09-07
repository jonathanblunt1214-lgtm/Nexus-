const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
const bootstrapEntry = fs.readFileSync(path.join(root, 'bootstrapEntry.js'), 'utf8');
const crucibleUi = fs.readFileSync(path.join(root, 'cruciblePluginUi.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const languageServices = fs.readFileSync(path.join(root, 'officialLanguageServers.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('coding provider UI hides saved secrets and supports replacement without revealing them', () => {
  assert.match(bootstrap, /syncProviderCardFromState/);
  assert.match(bootstrap, /Boolean\(current\?\.configured\)/);
  assert.match(bootstrap, /Configured · key hidden/);
  assert.match(bootstrap, /providerReplaceKey/);
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
  assert.match(languageServices, /configuredSource:detected \? 'path' : null/);
  assert.match(languageServices, /autoDetected:detected/);
  assert.match(languageServices, /process\.env\.NEXUS_PSES_PATH/);
  assert.match(bootstrap, /syncLanguageServiceControls/);
  assert.match(bootstrap, /button\.hidden = Boolean\(provider\.configured\)/);
  assert.match(bootstrap, /repeat\(auto-fit, minmax\(150px, 1fr\)\)/);
});

test('Nexus starts with no active project until the user explicitly chooses one', () => {
  assert.equal(packageJson.main, 'bootstrapEntry.js');
  assert.ok(packageJson.build.files.includes('bootstrapEntry.js'));
  assert.match(bootstrapEntry, /localStorage\.removeItem\('nexus_active'\)/);
  assert.match(bootstrapEntry, /activeProjectId = null/);
  assert.match(bootstrapEntry, /header\.textContent = 'None'/);
  assert.match(bootstrapEntry, /require\('\.\/bootstrap'\)/);
});

test('Live Preview receives a one-time dominant default while user resizing remains persistent', () => {
  assert.match(crucibleUi, /nexus_workspace_layout_version/);
  assert.match(crucibleUi, /nexus_workspace_col_fraction', '0\.68'/);
  assert.match(crucibleUi, /nexus_workspace_row_fraction', '0\.68'/);
  assert.match(crucibleUi, /gridTemplateColumns = '0\.68fr 6px 0\.32fr'/);
  assert.match(crucibleUi, /gridTemplateRows = '0\.68fr 6px 0\.32fr'/);
  assert.match(renderer, /localStorage\.setItem\('nexus_workspace_col_fraction'/);
  assert.match(renderer, /localStorage\.setItem\('nexus_workspace_row_fraction'/);
});

test('AI Code Assist is prompt-first and reuses the guarded Feature Builder planning path', () => {
  assert.match(crucibleUi, /id=\\"nexus-ai-build-prompt\\"/);
  assert.match(crucibleUi, /Plan & Build/);
  assert.match(crucibleUi, /featureDescription\.value = prompt/);
  assert.match(crucibleUi, /planFeature\(\)/);
  assert.match(crucibleUi, /Targeted file repair \(advanced\)/);
  assert.match(renderer, /async function planFeature\(\)/);
  assert.match(renderer, /window\.nexus\.aiPlanFeature/);
});

test('obsolete manual build approval UI is removed at launch because build assignment is automatic', () => {
  assert.match(indexHtml, /id="approve-build-number-btn"/);
  assert.match(crucibleUi, /approve-build-number-btn/);
  assert.match(crucibleUi, /manualBuildCard\.remove\(\)/);
});

test('Settings launch cleanup exposes only supported hosted coding providers', () => {
  assert.match(crucibleUi, /new Set\(\['nim', 'kimi', 'deepseek'\]\)/);
  assert.match(crucibleUi, /Get Z\.ai key/);
  assert.match(crucibleUi, /Safe Provider Discovery/);
  assert.match(crucibleUi, /Ollama/);
  assert.match(crucibleUi, /LM Studio/);
});

test('Check for updates control is present, wired, and protected from markup drift', () => {
  assert.match(indexHtml, /id="update-check-btn"[^>]*onclick="checkForReleaseUpdate\(\)"/);
  assert.match(renderer, /async function checkForReleaseUpdate\(\)/);
  assert.match(renderer, /window\.nexus\.checkForUpdates\(\)/);
  assert.match(crucibleUi, /if \(!document\.getElementById\('update-check-btn'\)\)/);
  assert.match(crucibleUi, /checkForReleaseUpdate\(\)/);
});
