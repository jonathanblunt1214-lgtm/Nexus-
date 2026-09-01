const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const bootstrap = fs.readFileSync(path.join(__dirname, '..', 'bootstrap.js'), 'utf8');

test('Safe Provider Discovery only exposes supported hosted providers', () => {
  assert.match(bootstrap, /new Set\(\['nim', 'kimi', 'deepseek'\]\)/);
  assert.match(bootstrap, /option\[value="ollama"\]/);
  assert.match(bootstrap, /option\[value="lmstudio"\]/);
  assert.doesNotMatch(bootstrap, /Local services/);
  assert.doesNotMatch(bootstrap, /Ollama \/ LM Studio models/);
});

test('saved provider keys are represented only as configured state', () => {
  assert.match(bootstrap, /Configured · key hidden/);
  assert.match(bootstrap, /codingModelsStatus\(\)/);
  assert.match(bootstrap, /rowState\.entry\.style\.display = configured \? 'none' : ''/);
  assert.match(bootstrap, /input\.value = ''/);
  assert.match(bootstrap, /autocomplete = 'new-password'/);
});

test('provider discovery distinguishes saved Nexus keys from optional environment imports', () => {
  assert.match(bootstrap, /Saved Nexus keys are shown above/);
  assert.match(bootstrap, /Available environment imports/);
  assert.match(bootstrap, /value remains hidden/);
  assert.match(bootstrap, /importEnvironmentProviderKey\(item\.env\)/);
});
