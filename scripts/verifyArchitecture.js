// scripts/verifyArchitecture.js
// Regression gate for the stabilized control plane and Section 1 context engine.

const fs = require('fs');
const path = require('path');

const checks = [
  {
    file: 'aiInventory.js',
    forbidden: [/readdirSync\s*\(/, /statSync\s*\(/, /readFileSync\s*\(/],
    message: 'AI inventory traversal must remain off the Electron main thread.',
  },
  {
    file: 'semanticContext.js',
    forbidden: [/readdirSync\s*\(/, /readFileSync\s*\(/, /require\(['"]web-tree-sitter['"]\)/],
    message: 'Semantic parsing must remain inside semanticWorker.js, not the main-process facade.',
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

const requiredFiles = [
  ['inventoryWorker.js', 'background inventory scanning'],
  ['atomicWrite.js', 'crash-safe registry persistence'],
  ['astEngine.js', 'Tree-sitter structural parsing'],
  ['workspaceIndexer.js', 'incremental SHA-256 workspace indexing'],
  ['semanticWorker.js', 'off-main-thread semantic context generation'],
  ['semanticContext.js', 'semantic worker request lifecycle management'],
];

for (const [file, purpose] of requiredFiles) {
  if (fs.existsSync(path.join(__dirname, '..', file))) continue;
  failures += 1;
  console.error(`[FAIL] ${file} is required for ${purpose}.`);
}

const astSource = fs.readFileSync(path.join(__dirname, '..', 'astEngine.js'), 'utf8');
if (!/web-tree-sitter/.test(astSource)) {
  failures += 1;
  console.error('[FAIL] astEngine.js must use web-tree-sitter for structural parsing.');
}

const semanticWorkerSource = fs.readFileSync(path.join(__dirname, '..', 'semanticWorker.js'), 'utf8');
if (!/indexWorkspace/.test(semanticWorkerSource) || !/buildRepositoryMap/.test(semanticWorkerSource)) {
  failures += 1;
  console.error('[FAIL] semanticWorker.js must produce an incremental index and bounded repository map.');
}

if (failures > 0) {
  console.error(`Architecture audit failed with ${failures} violation(s).`);
  process.exit(1);
}

console.log('[PASS] Section 0/1 architecture guardrails verified.');
