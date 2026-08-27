// aiGuardrailTester.js
// Main-process module: finds and runs a project's own guardrail/safety/
// contract test scripts (e.g. "test:safety-contract") and reports real
// pass/fail results. Never invents a passing result - if a project has no
// guardrail scripts, it says so instead of reporting a score.
//
// Runs each script via `npm run <name>` through execFile with an argv array
// (no shell). On Windows, npm is exposed through a .cmd shim, which cannot
// be executed reliably by execFile on current Node releases. Invoke npm's
// JavaScript CLI with the current Node executable instead so script names
// remain argv data rather than shell input.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const RUNS_FILENAME = '.nexus-ai-guardrail-runs.json';
const MAX_RUNS = 200;
const GUARDRAIL_SCRIPT_PATTERN = /guardrail|contract|safety|compliance|constitution/i;

function npmInvocation() {
  if (process.platform !== 'win32') return { file: 'npm', prefixArgs: [] };
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return { file: process.execPath, prefixArgs: [npmCli] };
}

function findGuardrailScripts(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return Object.keys(pkg.scripts || {}).filter((name) => GUARDRAIL_SCRIPT_PATTERN.test(name));
  } catch {
    return [];
  }
}

function runNpmScript(projectPath, scriptName) {
  return new Promise((resolve) => {
    const start = Date.now();
    const { file, prefixArgs } = npmInvocation();
    execFile(file, [...prefixArgs, 'run', scriptName], { cwd: projectPath, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        script: scriptName,
        passed: !error,
        durationMs: Date.now() - start,
        output: ((stdout || '') + (stderr ? '\n' + stderr : '')).trim().slice(-4000),
        error: error ? error.message : null,
      });
    });
  });
}

function runsPath(projectPath) {
  return path.join(projectPath, RUNS_FILENAME);
}

function loadRuns(projectPath) {
  const file = runsPath(projectPath);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveRun(projectPath, run) {
  const runs = loadRuns(projectPath);
  runs.push(run);
  fs.writeFileSync(runsPath(projectPath), JSON.stringify(runs.slice(-MAX_RUNS), null, 2), 'utf8');
}

/**
 * Runs every guardrail/contract/safety script the project defines and
 * records the result. Returns { ok, hasGuardrails, results, score }.
 */
async function runGuardrailTests(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) {
    return { ok: false, error: 'Folder not found.' };
  }
  const scripts = findGuardrailScripts(projectPath);
  if (scripts.length === 0) {
    return { ok: true, hasGuardrails: false, results: [], score: null, message: 'No guardrail/contract/safety scripts found in package.json.' };
  }

  const results = [];
  for (const script of scripts) {
    results.push(await runNpmScript(projectPath, script));
  }

  const passed = results.filter((r) => r.passed).length;
  const score = +((passed / results.length) * 100).toFixed(1);

  const run = { runAt: new Date().toISOString(), score, passed, total: results.length, results: results.map((r) => ({ script: r.script, passed: r.passed, durationMs: r.durationMs })) };
  saveRun(projectPath, run);

  return { ok: true, hasGuardrails: true, results, score, passed, total: results.length };
}

function getGuardrailHistory(projectPath, limit = 20) {
  return loadRuns(projectPath).slice(-limit).reverse();
}

module.exports = { runGuardrailTests, getGuardrailHistory, findGuardrailScripts };
