// scripts/verifyArchitecture.js
// Section 0 regression gate for the stabilized control-plane architecture.

const fs = require('fs');
const path = require('path');

const checks = [
  {
    file: 'aiInventory.js',
    forbidden: [/readdirSync\s*\(/, /statSync\s*\(/, /readFileSync\s*\(/],
    message: 'AI inventory traversal must remain off the Electron main thread.',
  },
  {
    file: 'projectRegistry.js',
    forbidden: [/writeFileSync\s*\(\s*REGISTRY_FILE/],
    message: 'Project registry persistence must flow through the atomic-write helper.',
  },
];

let failures = 0;

for (const check of checks) {
  const fullPath = path.join(__dirname, '..', check.file);
  const source = fs.readFileSync(fullPath, 'utf8');

  for (const pattern of check.forbidden) {
    if (!pattern.test(source)) continue;
    failures += 1;
    console.error(`[FAIL] ${check.file}: ${check.message}`);
    console.error(`       matched ${pattern}`);
  }
}

const workerPath = path.join(__dirname, '..', 'inventoryWorker.js');
const atomicPath = path.join(__dirname, '..', 'atomicWrite.js');

if (!fs.existsSync(workerPath)) {
  failures += 1;
  console.error('[FAIL] inventoryWorker.js is required for background inventory scanning.');
}
if (!fs.existsSync(atomicPath)) {
  failures += 1;
  console.error('[FAIL] atomicWrite.js is required for crash-safe registry persistence.');
}

if (failures > 0) {
  console.error(`Architecture audit failed with ${failures} violation(s).`);
  process.exit(1);
}

console.log('[PASS] Section 0 architecture guardrails verified.');
