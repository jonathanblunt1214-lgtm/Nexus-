const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { PROVIDERS, provider } = require('../codingModelProviders');

test('offers supported coding providers without Z.ai', () => {
  assert.equal(PROVIDERS.nim.model, 'qwen/qwen3-coder-next');
  assert.equal(PROVIDERS.nim.endpoint, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(PROVIDERS.kimi.model, 'kimi-k3');
  assert.equal(PROVIDERS.kimi.endpoint, 'https://api.moonshot.ai/v1/chat/completions');
  assert.equal(PROVIDERS.deepseek.model, 'deepseek-v4-pro');
  assert.equal(PROVIDERS.deepseek.endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(provider('glm'), null);
  assert.equal(provider('unknown'), null);
  assert.doesNotMatch(JSON.stringify(PROVIDERS), /z\.ai|GLM/i);
});

test('coding provider settings save, activate, and reuse the NVIDIA key path', () => {
  const main = fs.readFileSync(require.resolve('../main'), 'utf8');
  const bootstrap = fs.readFileSync(require.resolve('../bootstrap'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer'), 'utf8');
  assert.match(main, /callSelectedCodingModel/);
  assert.match(main, /setEncryptedConfigValue\(cfg, `\$\{id\}ApiKey`/);
  assert.match(main, /callNimForProjectGeneration[\s\S]*callSelectedCodingModel/);
  assert.match(bootstrap, /id === 'nim' \? handlers\.get\('save-nim-key'\)/);
  assert.match(bootstrap, /coding-models:select/);
  assert.match(bootstrap, /activated:true/);
  assert.match(bootstrap, /option\[value=\\"glm\\"\]/);
  assert.doesNotMatch(renderer, /ApiKeyEnc|access_token/);
});
