const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const workerCount = Math.max(2, Math.min(4, Number(process.env.NEXUS_STRESS_WORKERS) || 4));

function runWorker(index) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test'], {
      cwd: root,
      env: { ...process.env, NEXUS_STRESS_WORKER: String(index) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve();
      reject(new Error(`Stress worker ${index} failed with exit code ${code}.\n${output.slice(-8000)}`));
    });
  });
}

async function main() {
  console.log(`[stress-gate] Running the complete test suite in ${workerCount} concurrent workloads.`);
  const results = await Promise.allSettled(Array.from({ length: workerCount }, (_, i) => runWorker(i + 1)));
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    for (const failure of failures) console.error(failure.reason?.stack || failure.reason);
    throw new Error(`${failures.length} of ${workerCount} stress workloads failed. Release blocked.`);
  }
  console.log(`[stress-gate] PASS: ${workerCount} concurrent complete-suite workloads finished successfully.`);
}

main().catch(error => {
  console.error(`[stress-gate] FAIL: ${error.message}`);
  process.exitCode = 1;
});
