const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const bootstrap = fs.readFileSync(path.join(__dirname, '..', 'bootstrap.js'), 'utf8');

test('Nexus keeps one native fallback instead of duplicating AI Collaboration providers', () => {
  assert.match(bootstrap, /new Set\(\['nim'\]\)/);
  assert.match(bootstrap, /option\.value !== 'nim'/);
  assert.match(bootstrap, /removeCard\('Safe Provider Discovery'\)/);
  assert.doesNotMatch(bootstrap, /safe-provider-hosted-keys/);
  assert.doesNotMatch(bootstrap, /providers = \[\s*\{ id:'nim'/);
});

test('saved provider keys are represented only as configured state', () => {
  assert.match(bootstrap, /Configured · key hidden/);
  assert.match(bootstrap, /codingModelsStatus\(\)/);
  assert.match(bootstrap, /key\.style\.display = 'none'/);
  assert.match(bootstrap, /key\.value = ''/);
  assert.match(bootstrap, /providerReplaceButton\.style\.display = ''/);
});

test('provider discovery no longer creates duplicate hosted-key controls', () => {
  assert.doesNotMatch(bootstrap, /Available environment imports/);
  assert.doesNotMatch(bootstrap, /importEnvironmentProviderKey\(item\.env\)/);
});
