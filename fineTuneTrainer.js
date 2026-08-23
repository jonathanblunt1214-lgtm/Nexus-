const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function openAiRequest(apiKey, endpoint, options = {}) {
  const response = await fetch(`https://api.openai.com/v1${endpoint}`, { ...options, headers:{ Authorization:`Bearer ${apiKey}`, ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI returned HTTP ${response.status}.`);
  return data;
}

async function startOpenAiFineTune({ apiKey, trainingFile, validationFile, model, suffix = 'nexus-webdev' }) {
  if (!apiKey) throw new Error('An approved OpenAI API key is required.');
  if (!fs.existsSync(trainingFile)) throw new Error('Training JSONL does not exist.');
  const upload = async (file) => {
    const form = new FormData();
    form.append('purpose', 'fine-tune');
    form.append('file', new Blob([fs.readFileSync(file)], { type:'application/jsonl' }), path.basename(file));
    form.append('expires_after[anchor]', 'created_at');
    form.append('expires_after[seconds]', '2592000');
    return openAiRequest(apiKey, '/files', { method:'POST', body:form });
  };
  const training = await upload(trainingFile);
  const validation = validationFile && fs.existsSync(validationFile) ? await upload(validationFile) : null;
  const body = { model, training_file:training.id, suffix:String(suffix).slice(0, 64) };
  if (validation) body.validation_file = validation.id;
  const job = await openAiRequest(apiKey, '/fine_tuning/jobs', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  return { ok:true, provider:'openai', jobId:job.id, status:job.status, model:job.model, trainingFileId:training.id, validationFileId:validation?.id || null };
}

async function getOpenAiFineTune(apiKey, jobId) {
  const job = await openAiRequest(apiKey, `/fine_tuning/jobs/${encodeURIComponent(jobId)}`);
  return { ok:true, provider:'openai', jobId:job.id, status:job.status, fineTunedModel:job.fine_tuned_model || null, error:job.error || null };
}

function startLocalLora({ pythonExecutable, scriptPath, trainingFile, validationFile, model, outputDir, onExit = () => {} }) {
  for (const [label, value] of Object.entries({ pythonExecutable, scriptPath, trainingFile, model, outputDir })) if (!value) throw new Error(`${label} is required.`);
  if (!path.isAbsolute(pythonExecutable) || !path.isAbsolute(scriptPath) || !path.isAbsolute(trainingFile) || !path.isAbsolute(outputDir)) throw new Error('Local training paths must be absolute.');
  const args = [scriptPath, '--model', model, '--train', trainingFile, '--output', outputDir];
  if (validationFile) args.push('--validation', validationFile);
  const child = spawn(pythonExecutable, args, { shell:false, windowsHide:true, stdio:['ignore','pipe','pipe'] });
  let log = '';
  child.stdout.on('data', (data) => { log = `${log}${data}`.slice(-50000); });
  child.stderr.on('data', (data) => { log = `${log}${data}`.slice(-50000); });
  child.on('close', (code) => onExit({ code, ok:code === 0, log }));
  return { ok:true, provider:'local-lora', pid:child.pid, model, outputDir };
}

module.exports = { startOpenAiFineTune, getOpenAiFineTune, startLocalLora };
