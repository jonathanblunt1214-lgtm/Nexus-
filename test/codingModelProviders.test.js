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

test('coding provider settings save, activate, reuse NVIDIA key storage, and expose only supported hosted providers', () => {
  const main = fs.readFileSync(require.resolve('../main'), 'utf8');
  const bootstrap = fs.readFileSync(require.resolve('../bootstrap'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer'), 'utf8');
  assert.match(main, /callSelectedCodingModel/);
  assert.match(main, /setEncryptedConfigValue\(cfg, `\$\{id\}ApiKey`/);
  assert.match(main, /callNimForProjectGeneration[\s\S]*callSelectedCodingModel/);
  assert.match(bootstrap, /id === 'nim' \? handlers\.get\('save-nim-key'\)/);
  assert.match(bootstrap, /coding-models:select/);
  assert.match(bootstrap, /activated:true/);
  assert.match(bootstrap, /new Set\(\['nim', 'kimi', 'deepseek'\]\)/);
  assert.match(bootstrap, /result\.providers = result\.providers\.filter\(\(item\) => hostedProviders\.has\(item\.id\)\)/);
  assert.doesNotMatch(renderer, /ApiKeyEnc|access_token/);
});

test('retired Gemini/OpenAI settings are physically absent from application source', () => {
  const files = ['main.js', 'preload.js', 'renderer.js', 'index.html', 'bootstrap.js'];
  const contents = Object.fromEntries(files.map((file) => [file, fs.readFileSync(require.resolve('../' + file), 'utf8')]));
  const retired = /save-gemini-key|has-gemini-key|clear-gemini-key|save-openai-key|has-openai-key|clear-openai-key|openai-ask|Gemini API Key|OpenAI API Key|Ask OpenAI/;
  for (const [file, content] of Object.entries(contents)) assert.doesNotMatch(content, retired, file);
  assert.doesNotMatch(contents['index.html'], /Ask Gemini/);
  assert.match(contents['main.js'], /NEXUS_GEMINI_API_KEY/);
  assert.match(contents['main.js'], /gemini-ask/);
  assert.match(contents['preload.js'], /geminiAsk/);
});
