const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TrainingDataset, redactText } = require('../trainingDataset');

function dataset(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-training-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  return new TrainingDataset(root);
}

test('only real passing verification can enter the training dataset', (t) => {
  const store = dataset(t);
  const rejected = store.recordVerified({ request:'Build a page', response:'<main>Done</main>', verification:{ passed:false, testsRun:1 } });
  assert.equal(rejected.ok, false);
  const accepted = store.recordVerified({ request:'Build a page', response:'<main>Done</main>', verification:{ passed:true, testsRun:3, command:'npm test' } });
  assert.equal(accepted.ok, true);
  assert.equal(store.summary().verifiedExamples, 1);
  assert.equal(store.recordVerified({ request:'Build a page', response:'<main>Done</main>', verification:{ passed:true, testsRun:3, command:'npm test' } }).duplicate, true);
});

test('credentials and personal Windows paths are removed before persistence', (t) => {
  const store = dataset(t);
  const privatePath = ['C:', 'Users', 'sample-user', 'site'].join('\\');
  const fakeToken = ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_');
  store.recordVerified({ request:`Use token="${fakeToken}" in ${privatePath}`, response:'Authorization: Bearer abc.def.ghi', verification:{ passed:true, testsRun:1 } });
  const serialized = JSON.stringify(store.examples());
  assert.doesNotMatch(serialized, /ghp_|abc\.def|Users\\\\sample-user/);
  assert.match(serialized, /REDACTED|USER_HOME/);
  assert.doesNotMatch(redactText("api_key='this-is-a-private-value'"), /private-value/);
});

test('verified examples become deterministic chat JSONL training and validation sets', (t) => {
  const store = dataset(t);
  for (let index = 0; index < 10; index += 1) store.recordVerified({ request:`Build feature ${index}`, context:'Existing app', response:`Verified code ${index}`, verification:{ passed:true, testsRun:2, command:'npm test' } });
  const prepared = store.prepare();
  assert.equal(prepared.ok, true);
  assert.equal(prepared.manifest.total, 10);
  assert.equal(prepared.manifest.training, 9);
  assert.equal(prepared.manifest.validation, 1);
  const row = JSON.parse(fs.readFileSync(prepared.trainingFile, 'utf8').trim().split('\n')[0]);
  assert.deepEqual(row.messages.map((message) => message.role), ['system','user','assistant']);
});

test('local trainer is real TRL and PEFT LoRA weight training', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'train_lora.py'), 'utf8');
  assert.match(script, /SFTTrainer/);
  assert.match(script, /LoraConfig/);
  assert.match(script, /trainer\.train\(\)/);
  assert.match(script, /target_modules="all-linear"/);
  assert.match(script, /BitsAndBytesConfig/);
  assert.match(script, /prepare_model_for_kbit_training/);
});

test('cloud trainer uses fine-tune file and job APIs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'fineTuneTrainer.js'), 'utf8');
  assert.match(source, /purpose.*fine-tune/);
  assert.match(source, /\/fine_tuning\/jobs/);
  assert.match(source, /validation_file/);
});

test('Nexus exposes consent-gated training controls and records verified autonomous changes', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  for (const channel of ['training:summary','training:prepare','training:choose-python','training:start','training:status']) {
    assert.ok(main.includes(channel));
    assert.ok(preload.includes(channel));
  }
  assert.match(main, /guardrailResult\.hasGuardrails && guardrailResult\.passed === guardrailResult\.total/);
  assert.match(main, /approved !== true/);
  assert.match(html, /Model Training/);
  assert.match(html, /Ten verified examples are required/);
  assert.match(renderer, /Review & Start Training|trainingStart/);
  assert.match(renderer, /may incur charges/);
});

test('checker learning stores only approved passing corrections and excludes faulty source', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /stageVerifiedCheckerCorrection/);
  assert.match(main, /originalErrors\.length/);
  assert.match(main, /correctedChecker\.available/);
  assert.match(main, /Only the verified corrected result is included; faulty source and failed attempts are excluded/);
  assert.match(main, /savedContent === candidate\.expectedContent/);
  assert.match(main, /trainingCandidates\.delete\(path\.resolve\(filePath\)\)/);
  assert.match(main, /Nexus \$\{candidate\.checker\} checker/);
  assert.doesNotMatch(main.match(/function stageVerifiedCheckerCorrection[\s\S]*?\r?\n}\r?\n/)?.[0] || '', /BEFORE:/);
  const aiFixHandler = main.match(/ipcMain\.handle\('ai-propose-fix'[\s\S]*?\n}\);/)?.[0] || '';
  assert.doesNotMatch(aiFixHandler, /stageVerifiedCheckerCorrection|trainingCandidates\.set/);
});
