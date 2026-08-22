const ENVIRONMENT_KEYS = Object.freeze([
  { env:'NVIDIA_API_KEY', provider:'nim', name:'NVIDIA NIM' },
  { env:'MOONSHOT_API_KEY', provider:'kimi', name:'Kimi / Moonshot' },
  { env:'KIMI_API_KEY', provider:'kimi', name:'Kimi / Moonshot' },
  { env:'ZAI_API_KEY', provider:'glm', name:'Z.ai GLM' },
  { env:'ZHIPUAI_API_KEY', provider:'glm', name:'Z.ai GLM' },
  { env:'DEEPSEEK_API_KEY', provider:'deepseek', name:'DeepSeek' },
  { env:'OPENAI_API_KEY', provider:'openai', name:'OpenAI' },
  { env:'GEMINI_API_KEY', provider:'gemini', name:'Google Gemini' },
]);

function detectedEnvironmentKeys(environment = process.env) {
  return ENVIRONMENT_KEYS.filter((item) => typeof environment[item.env] === 'string' && environment[item.env].trim()).map(({ env, provider, name }) => ({ env, provider, name }));
}

async function fetchJson(url, timeout = 1200) {
  const response = await fetch(url, { signal:AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function detectLocalServices() {
  const services = [];
  try { const data = await fetchJson('http://127.0.0.1:11434/api/tags'); services.push({ id:'ollama', name:'Ollama', endpoint:'http://127.0.0.1:11434/v1/chat/completions', models:(data.models || []).map((item) => item.name).filter(Boolean) }); } catch {}
  try { const data = await fetchJson('http://127.0.0.1:1234/v1/models'); services.push({ id:'lmstudio', name:'LM Studio', endpoint:'http://127.0.0.1:1234/v1/chat/completions', models:(data.data || []).map((item) => item.id).filter(Boolean) }); } catch {}
  return services;
}

module.exports = { ENVIRONMENT_KEYS, detectedEnvironmentKeys, detectLocalServices };
