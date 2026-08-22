const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { detectedEnvironmentKeys, ENVIRONMENT_KEYS } = require('../providerDiscovery');

test('detects only allowlisted environment key names and never returns values', () => {
  const results = detectedEnvironmentKeys({ DEEPSEEK_API_KEY:'super-secret', RANDOM_KEY:'not-allowed' });
  assert.deepEqual(results, [{ env:'DEEPSEEK_API_KEY', provider:'deepseek', name:'DeepSeek' }]);
  assert.doesNotMatch(JSON.stringify(results), /super-secret|not-allowed/);
  assert.ok(ENVIRONMENT_KEYS.every((item) => /_API_KEY$/.test(item.env)));
});

test('provider discovery is localhost-only and imports require explicit renderer confirmation', () => {
  const discovery = fs.readFileSync(require.resolve('../providerDiscovery'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer'), 'utf8');
  const main = fs.readFileSync(require.resolve('../main'), 'utf8');
  assert.match(discovery, /127\.0\.0\.1:11434/);
  assert.match(discovery, /127\.0\.0\.1:1234/);
  assert.doesNotMatch(discovery, /readdir|github|search_query/);
  assert.match(renderer, /confirm\(`Import your/);
  assert.match(main, /setEncryptedConfigValue/);
  assert.doesNotMatch(main, /provider-discovery:scan[\s\S]{0,300}process\.env\[/);
});
