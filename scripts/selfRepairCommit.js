const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const reportPath = path.join(root, '.nexus-self-repair-report.json');

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    ...options,
  });
  return {
    command: [command, ...commandArgs].join(' '),
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

function workflowFiles() {
  return trackedFiles().filter((file) => file.startsWith('.github/workflows/') && /\.ya?ml$/i.test(file));
}

function hardenWorkflow(file) {
  const absolute = path.join(root, file);
  let text = fs.readFileSync(absolute, 'utf8');
  const original = text;
  const findings = [];

  if (/ref:\s*\$\{\{\s*matrix\.ref\s*\}\}/.test(text)) {
    findings.push('dynamic matrix.ref checkout can execute privileged untrusted code');
    if (apply) text = text.replace(/ref:\s*\$\{\{\s*matrix\.ref\s*\}\}/g, 'ref: main');
  }

  if (/uses:\s*actions\/checkout@[^\n]+\n(?:\s+with:\n)?(?:(?!persist-credentials:)[\s\S])*?/m.test(text) && /workflow_dispatch:|schedule:/m.test(text)) {
    // Add persist-credentials only to checkout blocks that already have a `with:` section.
    if (apply) {
      text = text.replace(/(\s+- uses:\s*actions\/checkout@[^\n]+\n\s+with:\n)(?!\s+persist-credentials:)/g, '$1          persist-credentials: false\n');
    }
  }

  if (apply && text !== original) fs.writeFileSync(absolute, text);
  return { file, changed: text !== original, findings };
}

function inventoryRepairNeeded(result) {
  return result.status !== 0 && /Repository inventory is stale|inventory count mismatch|repository-file-manifest\.json is missing/i.test(`${result.stdout}\n${result.stderr}`);
}

const report = {
  schemaVersion: 1,
  mode: apply ? 'apply' : 'check',
  head: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
  workflowRepairs: [],
  checks: [],
  repairs: [],
  unresolved: [],
};

for (const file of workflowFiles()) {
  const item = hardenWorkflow(file);
  if (item.findings.length || item.changed) report.workflowRepairs.push(item);
  if (item.changed) report.repairs.push(`Hardened ${file}`);
}

const deterministicChecks = [
  ['node', ['scripts/checkSyntax.js']],
  ['node', ['scripts/verifyArchitecture.js']],
  ['node', ['scripts/privacyRetryGate.js']],
];

for (const [command, commandArgs] of deterministicChecks) {
  const result = run(command, commandArgs);
  report.checks.push(result);
  if (result.status !== 0) report.unresolved.push(`${result.command} failed; repair is ambiguous and was not guessed.`);
}

let inventory = run('node', ['scripts/verifyRepositoryInventory.js']);
report.checks.push(inventory);
if (inventoryRepairNeeded(inventory)) {
  if (apply) {
    const update = run('node', ['scripts/verifyRepositoryInventory.js', '--write']);
    report.checks.push(update);
    if (update.status === 0) {
      report.repairs.push('Regenerated repository-file-manifest.json after deterministic repository changes.');
      inventory = run('node', ['scripts/verifyRepositoryInventory.js']);
      report.checks.push(inventory);
    }
  }
  if (!apply || inventory.status !== 0) report.unresolved.push('Repository inventory requires regeneration.');
} else if (inventory.status !== 0) {
  report.unresolved.push('Repository inventory failed for a reason that is not safe to auto-repair.');
}

const dirty = run('git', ['status', '--porcelain']);
report.changedFiles = dirty.stdout.split(/\r?\n/).filter(Boolean);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`[self-repair] mode=${report.mode} repairs=${report.repairs.length} unresolved=${report.unresolved.length}`);
for (const repair of report.repairs) console.log(`[self-repair] repaired: ${repair}`);
for (const unresolved of report.unresolved) console.error(`[self-repair] unresolved: ${unresolved}`);

if (report.unresolved.length) process.exit(2);
