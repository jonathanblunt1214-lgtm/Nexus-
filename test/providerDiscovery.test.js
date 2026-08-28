const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { detectedEnvironmentKeys, detectLocalServices, ENVIRONMENT_KEYS } = require('../providerDiscovery');

test('detects only allowlisted environment key names and never returns values', () => {
  const results = detectedEnvironmentKeys({ DEEPSEEK_API_KEY:'super-secret', RANDOM_KEY:'not-allowed' });
  assert.deepEqual(results, [{ env:'DEEPSEEK_API_KEY', provider:'deepseek', name:'DeepSeek' }]);
  assert.doesNotMatch(JSON.stringify(results), /super-secret|not-allowed/);
  assert.ok(ENVIRONMENT_KEYS.every((item) => /_API_KEY$/.test(item.env)));
  assert.doesNotMatch(JSON.stringify(ENVIRONMENT_KEYS), /ZAI|ZHIPU|z\.ai|GLM|OPENAI|GEMINI/i);
});

test('local AI service discovery is disabled', async () => {
  const discovery = fs.readFileSync(require.resolve('../providerDiscovery'), 'utf8');
  assert.deepEqual(await detectLocalServices(), []);
  assert.doesNotMatch(discovery, /11434|1234|Ollama|LM Studio|lmstudio/i);
});

test('provider imports require explicit renderer confirmation', () => {
  const renderer = fs.readFileSync(require.resolve('../renderer'), 'utf8');
  const main = fs.readFileSync(require.resolve('../main'), 'utf8');
  assert.match(renderer, /confirm\(`Import your/);
  assert.match(main, /setEncryptedConfigValue/);
  assert.doesNotMatch(main, /provider-discovery:scan[\s\S]{0,300}process\.env\[/);
});
