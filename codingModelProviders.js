const PROVIDERS = Object.freeze({
  nim: Object.freeze({ id: 'nim', name: 'NVIDIA NIM · Qwen3 Coder Next', model: 'qwen/qwen3-coder-next', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions' }),
  kimi: Object.freeze({ id: 'kimi', name: 'Kimi K3', model: 'kimi-k3', endpoint: 'https://api.moonshot.ai/v1/chat/completions' }),
  glm: Object.freeze({ id: 'glm', name: 'GLM 5.2', model: 'GLM-5.2', endpoint: 'https://api.z.ai/api/paas/v4/chat/completions' }),
  deepseek: Object.freeze({ id: 'deepseek', name: 'DeepSeek V4 Pro', model: 'deepseek-v4-pro', endpoint: 'https://api.deepseek.com/chat/completions', thinking: true }),
  ollama: Object.freeze({ id:'ollama', name:'Ollama · Local', model:'auto', endpoint:'http://127.0.0.1:11434/v1/chat/completions', keyless:true }),
  lmstudio: Object.freeze({ id:'lmstudio', name:'LM Studio · Local', model:'auto', endpoint:'http://127.0.0.1:1234/v1/chat/completions', keyless:true }),
});
function provider(id) { return PROVIDERS[id] || null; }
async function callProvider(id, key, prompt, maxTokens = 4000, modelOverride = '') {
  const selected = provider(id);
  if (!selected) return { ok:false, error:'Unknown coding model provider.' };
  if (!key && !selected.keyless) return { ok:false, error:`No API key saved for ${selected.name}.`, model:selected.model };
  try {
    const model = modelOverride || selected.model;
    if (model === 'auto') return { ok:false, error:`Choose a local model for ${selected.name}.`, model };
    const body = { model, max_tokens:maxTokens, messages:[{ role:'user', content:prompt }] };
    if (selected.thinking) { body.thinking = { type:'enabled' }; body.reasoning_effort = 'high'; }
    const headers = { 'Content-Type':'application/json' }; if (key) headers.Authorization = `Bearer ${key}`;
    const response = await fetch(selected.endpoint, { method:'POST', headers, body:JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) return { ok:false, error:data?.error?.message || `HTTP ${response.status}`, model };
    return { ok:true, text:data?.choices?.[0]?.message?.content || '', model, usage:data?.usage || {} };
  } catch (error) { return { ok:false, error:error.message, model:modelOverride || selected.model }; }
}
module.exports = { PROVIDERS, provider, callProvider };
