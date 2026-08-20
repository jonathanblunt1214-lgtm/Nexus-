// aiUpgradeOrchestrator.js
// Main-process module: applies a config-level AI upgrade (e.g. swapping a
// model identifier in a config file) as a single guarded operation - backup,
// edit, re-validate, auto-rollback on failure. This is what turns "you could
// edit geminiConfig.ts by hand" into a one-call, safe action.
//
// Deliberately narrow: it does a literal find/replace on one file (never a
// regex built from user input, and never a shell command), then leans on
// the project's own guardrail tests and lint script - which already exist
// for the project's own reasons - to decide whether the change is safe to
// keep. Nothing here touches deployment; "deploy" in the framework doc is
// aspirational until a project actually has a deploy target to hook into.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { runGuardrailTests } = require('./aiGuardrailTester');

const UPGRADES_FILENAME = '.nexus-ai-upgrades.json';
const MAX_RECORDS = 200;
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function resolveInsideProject(projectPath, relOrAbsPath) {
  const resolved = path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.join(projectPath, relOrAbsPath);
  const normalizedProject = path.resolve(projectPath) + path.sep;
  const normalizedTarget = path.resolve(resolved);
  if (!(normalizedTarget + path.sep).startsWith(normalizedProject) && normalizedTarget !== path.resolve(projectPath)) {
    return null; // refuses to touch anything outside the project folder
  }
  return normalizedTarget;
}

function recordsPath(projectPath) {
  return path.join(projectPath, UPGRADES_FILENAME);
}

function loadRecords(projectPath) {
  const file = recordsPath(projectPath);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveRecord(projectPath, record) {
  const records = loadRecords(projectPath);
  records.push(record);
  fs.writeFileSync(recordsPath(projectPath), JSON.stringify(records.slice(-MAX_RECORDS), null, 2), 'utf8');
}

function runLint(projectPath) {
  return new Promise((resolve) => {
    const pkgPath = path.join(projectPath, 'package.json');
    let hasLint = false;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      hasLint = !!(pkg.scripts && pkg.scripts.lint);
    } catch {
      resolve({ ran: false, passed: true, output: '' });
      return;
    }
    if (!hasLint) { resolve({ ran: false, passed: true, output: '' }); return; }
    execFile(NPM_BIN, ['run', 'lint'], { cwd: projectPath, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ran: true, passed: !error, output: ((stdout || '') + (stderr ? '\n' + stderr : '')).trim().slice(-4000) });
    });
  });
}

/**
 * Describes what applyUpgrade would do, without doing it.
 */
function planUpgrade(projectPath, { configFile, find, replace }) {
  const steps = [
    { step: 1, label: `Back up ${configFile}`, detail: 'Copies the current file to <file>.nexus-upgrade-backup before touching it.' },
    { step: 2, label: `Replace "${find}" -> "${replace}"`, detail: 'A literal (non-regex) substring replace - fails if the text is not found, rather than silently doing nothing.' },
    { step: 3, label: 'Run guardrail/contract tests', detail: 'If the project has any (see aiGuardrailTester), they must all still pass.' },
    { step: 4, label: 'Run lint/type-check', detail: 'If the project defines an npm "lint" script, it must still pass.' },
    { step: 5, label: 'Keep or roll back', detail: 'Any failure in steps 3-4 restores the original file automatically.' },
  ];
  return { ok: true, steps };
}

/**
 * Applies a literal find/replace to one config file inside the project,
 * then validates the result with the project's own guardrail tests and
 * lint script. Automatically restores the original file if either fails.
 */
async function applyUpgrade(projectPath, { configFile, find, replace, label }) {
  if (!projectPath || !fs.existsSync(projectPath)) return { ok: false, error: 'Folder not found.' };
  if (!configFile || typeof find !== 'string' || typeof replace !== 'string' || !find) {
    return { ok: false, error: 'configFile, find, and replace are required (find must be non-empty).' };
  }

  const targetFile = resolveInsideProject(projectPath, configFile);
  if (!targetFile || !fs.existsSync(targetFile)) {
    return { ok: false, error: 'Config file not found inside the project folder.' };
  }

  const original = fs.readFileSync(targetFile, 'utf8');
  if (!original.includes(find)) {
    return { ok: false, error: `"${find}" was not found in ${configFile} - nothing changed.` };
  }

  const backupFile = targetFile + '.nexus-upgrade-backup';
  fs.writeFileSync(backupFile, original, 'utf8');

  const updated = original.split(find).join(replace);
  fs.writeFileSync(targetFile, updated, 'utf8');

  const guardrailResult = await runGuardrailTests(projectPath);
  const guardrailOk = !guardrailResult.hasGuardrails || guardrailResult.score === 100;

  let lintResult = { ran: false, passed: true, output: '' };
  if (guardrailOk) lintResult = await runLint(projectPath);

  const ok = guardrailOk && lintResult.passed;

  if (!ok) {
    fs.writeFileSync(targetFile, original, 'utf8');
  }
  try { fs.unlinkSync(backupFile); } catch { /* best effort cleanup */ }

  const record = {
    at: new Date().toISOString(),
    label: label || `${find} -> ${replace}`,
    configFile,
    find,
    replace,
    kept: ok,
    guardrailScore: guardrailResult.hasGuardrails ? guardrailResult.score : null,
    lintPassed: lintResult.ran ? lintResult.passed : null,
  };
  saveRecord(projectPath, record);

  return {
    ok,
    rolledBack: !ok,
    guardrailResult,
    lintResult,
    message: ok
      ? `Applied and kept: ${record.label}`
      : `Rolled back: ${record.label} (${!guardrailOk ? 'guardrail tests failed' : 'lint failed'})`,
  };
}

function getUpgradeHistory(projectPath, limit = 50) {
  return loadRecords(projectPath).slice(-limit).reverse();
}

module.exports = { planUpgrade, applyUpgrade, getUpgradeHistory };
