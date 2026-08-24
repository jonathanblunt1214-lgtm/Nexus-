const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const workerCount = Math.max(2, Math.min(4, Number(process.env.NEXUS_STRESS_WORKERS) || 4));
const timeoutMs = Math.max(60_000, Number(process.env.NEXUS_CRUCIBLE_TIMEOUT_MS) || 240_000);

function runProcess(label, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${label} exceeded ${timeoutMs}ms and was terminated.`)); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`${label} could not spawn: ${error.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve(output.trim());
      reject(new Error(`${label} failed with exit code ${code}.\n${output.slice(-8000)}`));
    });
  });
}

async function main() {
  console.log(`[Crucible] Running every release check together for up to four minutes: ${workerCount} complete test suites, ${workerCount} adaptive project workloads, architecture, release, privacy, and inventory verification.`);
  console.log(`[Crucible] Each workload processes ${Number(process.env.NEXUS_HEAVY_FILES) || 5000} files and repeats verified save, checker, index, and build cycles for as long as the time box allows.`);
  const jobs = [];
  for (let index = 1; index <= workerCount; index += 1) {
    jobs.push(runProcess(`Test worker ${index}`, ['--test'], { NEXUS_STRESS_WORKER:String(index) }));
    jobs.push(runProcess(`Heavy worker ${index}`, [path.join('scripts','heavyWorkloadWorker.js')], { NEXUS_STRESS_WORKER:String(index) }));
  }
  jobs.push(runProcess('Architecture audit', [path.join('scripts','verifyArchitecture.js')]));
  jobs.push(runProcess('Release audit', [path.join('scripts','releaseAudit.js')]));
  jobs.push(runProcess('Privacy verification', [path.join('scripts','verifyRepositoryPrivacy.js')]));
  jobs.push(runProcess('Repository inventory verification', [path.join('scripts','verifyRepositoryInventory.js')]));
  const results = await Promise.allSettled(jobs);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    for (const failure of failures) console.error(failure.reason?.stack || failure.reason);
    throw new Error(`${failures.length} of ${jobs.length} stress jobs failed. Release blocked.`);
  }
  const summaries = results.filter((_, index) => index < workerCount * 2 && index % 2 === 1).map((result) => JSON.parse(result.value.split(/\r?\n/).at(-1)));
  const totals = summaries.reduce((sum, item) => ({ cycles:sum.cycles + item.cycles, files:sum.files + item.files, saves:sum.saves + item.saves, checks:sum.checks + item.checks, builds:sum.builds + item.builds }), { cycles:0, files:0, saves:0, checks:0, builds:0 });
  console.log(`[Crucible] Completed ${totals.cycles} workload cycles across ${totals.files} files, ${totals.saves} atomic saves, ${totals.checks} checker calls, and ${totals.builds} verified builds.`);
  console.log(`[Crucible] PASS: all tests, adaptive workloads, audits, privacy checks, and inventory checks completed without corruption, incomplete builds, or hidden failures.`);
}

main().catch(error => {
  console.error(`[Crucible] FAIL: ${error.message}`);
  process.exitCode = 1;
});
