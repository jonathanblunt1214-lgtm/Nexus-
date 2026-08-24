const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const workerCount = Math.max(2, Math.min(4, Number(process.env.NEXUS_STRESS_WORKERS) || 4));
const timeoutMs = Math.max(60_000, Number(process.env.NEXUS_STRESS_TIMEOUT_MS) || 240_000);

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
  console.log(`[stress-gate] Running ${workerCount} complete test suites beside ${workerCount} heavy project workloads.`);
  console.log(`[stress-gate] Heavy target: ${workerCount * (Number(process.env.NEXUS_HEAVY_FILES) || 5000)} files, ${workerCount * (Number(process.env.NEXUS_HEAVY_SAVES) || 1000)} atomic saves, ${workerCount * (Number(process.env.NEXUS_HEAVY_CHECKS) || 1500)} checks, and ${workerCount * (Number(process.env.NEXUS_HEAVY_BUILDS) || 8)} builds.`);
  const jobs = [];
  for (let index = 1; index <= workerCount; index += 1) {
    jobs.push(runProcess(`Test worker ${index}`, ['--test'], { NEXUS_STRESS_WORKER:String(index) }));
    jobs.push(runProcess(`Heavy worker ${index}`, [path.join('scripts','heavyWorkloadWorker.js')], { NEXUS_STRESS_WORKER:String(index) }));
  }
  const results = await Promise.allSettled(jobs);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    for (const failure of failures) console.error(failure.reason?.stack || failure.reason);
    throw new Error(`${failures.length} of ${jobs.length} stress jobs failed. Release blocked.`);
  }
  console.log(`[stress-gate] PASS: ${workerCount} full suites and ${workerCount} heavy project workloads completed without corruption, incomplete builds, or hidden spawn failures.`);
}

main().catch(error => {
  console.error(`[stress-gate] FAIL: ${error.message}`);
  process.exitCode = 1;
});
