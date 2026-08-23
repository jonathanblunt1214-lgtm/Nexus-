const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/gi,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /((?:api[_-]?key|secret|token|password)\s*[:=]\s*['"])[^'"\s]{8,}(['"])/gi,
];

function redactText(value) {
  let text = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[REDACTED]');
  const home = os.homedir();
  if (home) text = text.replaceAll(home, '[USER_HOME]').replaceAll(home.replaceAll('\\', '/'), '[USER_HOME]');
  text = text.replace(/[A-Z]:\\Users\\[^\\\s]+/gi, '[USER_HOME]');
  return text;
}

function bounded(value, max = 120000) { return redactText(value).slice(0, max); }
function stableHash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

class TrainingDataset {
  constructor(root) {
    this.root = root;
    this.examplesDir = path.join(root, 'verified-examples');
    this.exportsDir = path.join(root, 'datasets');
    fs.mkdirSync(this.examplesDir, { recursive:true });
    fs.mkdirSync(this.exportsDir, { recursive:true });
  }

  recordVerified({ request, context = '', response, verification, project = null, file = null }) {
    if (!verification?.passed || Number(verification.testsRun || 0) < 1) return { ok:false, error:'A passing real test or guardrail result is required.' };
    if (!String(request || '').trim() || !String(response || '').trim()) return { ok:false, error:'Request and verified response are required.' };
    const example = {
      schemaVersion:1,
      request:bounded(request, 24000),
      context:bounded(context),
      response:bounded(response),
      verification:{ passed:true, testsRun:Number(verification.testsRun), command:bounded(verification.command || 'project verification', 1000), summary:bounded(verification.summary || '', 8000) },
      project:project ? bounded(path.basename(project), 200) : null,
      file:file ? bounded(String(file).replaceAll('\\', '/'), 1000) : null,
    };
    const id = stableHash(example);
    const target = path.join(this.examplesDir, `${id}.json`);
    if (fs.existsSync(target)) return { ok:true, duplicate:true, id };
    fs.writeFileSync(target, JSON.stringify({ ...example, id, recordedAt:new Date().toISOString() }, null, 2), { encoding:'utf8', flag:'wx' });
    return { ok:true, duplicate:false, id };
  }

  examples() {
    return fs.readdirSync(this.examplesDir).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort().map((name) => JSON.parse(fs.readFileSync(path.join(this.examplesDir, name), 'utf8')));
  }

  summary() {
    const examples = this.examples();
    return { ok:true, verifiedExamples:examples.length, ready:examples.length >= 10, minimumRequired:10, redactionEnabled:true, root:this.root };
  }

  prepare({ minimum = 10 } = {}) {
    const examples = this.examples();
    if (examples.length < minimum) return { ok:false, error:`At least ${minimum} verified examples are required; ${examples.length} are available.`, available:examples.length, required:minimum };
    const rows = examples.map((example) => ({ messages:[
      { role:'system', content:'Build production-quality applications and webpages. Preserve existing behavior, explain important decisions, and satisfy the supplied verification criteria.' },
      { role:'user', content:`REQUEST:\n${example.request}\n\nCONTEXT:\n${example.context}\n\nVERIFICATION REQUIRED:\n${example.verification.command}` },
      { role:'assistant', content:example.response },
    ], metadata:{ id:example.id, testsRun:example.verification.testsRun } }));
    const validation = rows.filter((_row, index) => index % 10 === 0);
    const training = rows.filter((_row, index) => index % 10 !== 0);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folder = path.join(this.exportsDir, stamp);
    fs.mkdirSync(folder, { recursive:false });
    const writeJsonl = (name, values) => { const target = path.join(folder, name); fs.writeFileSync(target, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`, 'utf8'); return target; };
    const trainingFile = writeJsonl('training.jsonl', training);
    const validationFile = writeJsonl('validation.jsonl', validation);
    const manifest = { schemaVersion:1, createdAt:new Date().toISOString(), total:rows.length, training:training.length, validation:validation.length, trainingSha256:stableHash(training), validationSha256:stableHash(validation), redactionEnabled:true };
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    return { ok:true, folder, trainingFile, validationFile, manifest };
  }
}

module.exports = { TrainingDataset, redactText, SECRET_PATTERNS };
