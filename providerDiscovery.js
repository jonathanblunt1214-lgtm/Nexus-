const ENVIRONMENT_KEYS = Object.freeze([
  { env:'NVIDIA_API_KEY', provider:'nim', name:'NVIDIA NIM' },
  { env:'MOONSHOT_API_KEY', provider:'kimi', name:'Kimi / Moonshot' },
  { env:'KIMI_API_KEY', provider:'kimi', name:'Kimi / Moonshot' },
  { env:'DEEPSEEK_API_KEY', provider:'deepseek', name:'DeepSeek' },
]);

function detectedEnvironmentKeys(environment = process.env) {
  return ENVIRONMENT_KEYS.filter((item) => typeof environment[item.env] === 'string' && environment[item.env].trim()).map(({ env, provider, name }) => ({ env, provider, name }));
}

async function detectLocalServices() {
  return [];
}

module.exports = { ENVIRONMENT_KEYS, detectedEnvironmentKeys, detectLocalServices };
