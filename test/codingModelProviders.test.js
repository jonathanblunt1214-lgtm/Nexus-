const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { PROVIDERS, provider } = require('../codingModelProviders');

test('offers verified Kimi K3, GLM 5.2, and DeepSeek V4 Pro provider definitions', () => {
  assert.equal(PROVIDERS.kimi.model, 'kimi-k3');
  assert.equal(PROVIDERS.kimi.endpoint, 'https://api.moonshot.ai/v1/chat/completions');
  assert.equal(PROVIDERS.glm.model, 'GLM-5.2');
  assert.equal(PROVIDERS.glm.endpoint, 'https://api.z.ai/api/paas/v4/chat/completions');
  assert.equal(PROVIDERS.deepseek.model, 'deepseek-v4-pro');
  assert.equal(PROVIDERS.deepseek.endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(provider('unknown'), null);
});

test('selected provider powers existing Nexus coding workflows through encrypted keys', () => {
  const main = fs.readFileSync(require.resolve('../main'), 'utf8');
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer'), 'utf8');
  assert.match(main, /callSelectedCodingModel/);
  assert.match(main, /setEncryptedConfigValue\(cfg, `\$\{id\}ApiKey`/);
  assert.match(main, /callNimForProjectGeneration[\s\S]*callSelectedCodingModel/);
  assert.match(html, /Kimi K3/);
  assert.match(html, /GLM 5\.2/);
  assert.match(html, /DeepSeek V4 Pro/);
  assert.doesNotMatch(renderer, /ApiKeyEnc|access_token/);
});
