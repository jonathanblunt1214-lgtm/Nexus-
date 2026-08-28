const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const write = (rel, text) => fs.writeFileSync(path.join(root, rel), text);

let discovery = read('providerDiscovery.js');
discovery = discovery
  .replace("  { env:'OPENAI_API_KEY', provider:'openai', name:'OpenAI' },\n", '')
  .replace("  { env:'GEMINI_API_KEY', provider:'gemini', name:'Google Gemini' },\n", '');
write('providerDiscovery.js', discovery);

let main = read('main.js');
main = main.replace(
  "const storageKey = allowed.provider === 'nim' ? 'nimKey' : allowed.provider === 'openai' ? 'openaiKey' : allowed.provider === 'gemini' ? 'geminiKey' : `${allowed.provider}ApiKey`;",
  "const storageKey = allowed.provider === 'nim' ? 'nimKey' : `${allowed.provider}ApiKey`;"
);
main = main.replace(
  "const ACCOUNT_VAULT_SECRET_KEYS = ['geminiKey', 'openaiKey', 'nimKey', 'kimiApiKey', 'glmApiKey', 'deepseekApiKey'];",
  "const ACCOUNT_VAULT_SECRET_KEYS = ['nimKey', 'kimiApiKey', 'deepseekApiKey'];"
);
main = main
  .replace('// Every real AI call Nexus itself makes (NIM, Gemini) is timed and recorded', '// Every real AI call Nexus itself makes is timed and recorded')
  .replace('// (the general Ask Gemini box, changelog generation) still get recorded', '// (for example, changelog generation) still get recorded')
  .replace('// --- Shared Gemini call, used only by the general "Ask Gemini" box now ---', '// --- Nexus-owned Gemini call. The credential is injected by the build. ---');
write('main.js', main);

let testFile = read('test/providerDiscovery.test.js');
const oldAssertion = "  assert.doesNotMatch(JSON.stringify(ENVIRONMENT_KEYS), /ZAI|ZHIPU|z\\.ai|GLM/i);";
const newAssertion = "  assert.doesNotMatch(JSON.stringify(ENVIRONMENT_KEYS), /ZAI|ZHIPU|z\\.ai|GLM|OPENAI|GEMINI/i);";
if (testFile.includes(oldAssertion)) testFile = testFile.replace(oldAssertion, newAssertion);
write('test/providerDiscovery.test.js', testFile);

const forbiddenDiscovery = /OPENAI_API_KEY|GEMINI_API_KEY|provider:'openai'|provider:'gemini'/i;
if (forbiddenDiscovery.test(read('providerDiscovery.js'))) throw new Error('Retired OpenAI/Gemini discovery entries remain.');
if (/allowed\.provider === 'openai'|allowed\.provider === 'gemini'|openaiKey|geminiKey|glmApiKey/.test(read('main.js'))) {
  throw new Error('Retired OpenAI/Gemini/GLM provider or account-vault key branches remain in main.js.');
}
for (const file of ['main.js','preload.js','renderer.js','index.html','bootstrap.js']) {
  const text = read(file);
  if (/save-gemini-key|has-gemini-key|clear-gemini-key|save-openai-key|has-openai-key|clear-openai-key|openai-ask|Gemini API Key|OpenAI API Key|Ask OpenAI/.test(text)) {
    throw new Error(`Retired AI Settings implementation remains in ${file}.`);
  }
}
if (/Ask Gemini/.test(read('index.html'))) throw new Error('Ask Gemini remains in Settings HTML.');
console.log('Final retired AI cleanup passed.');
