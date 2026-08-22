const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failures = 0;
const fail = (message) => { failures += 1; console.error(`[FAIL] ${message}`); };
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const checks = [
  ['aiInventory.js', [/readdirSync\s*\(/, /statSync\s*\(/, /readFileSync\s*\(/], 'AI inventory traversal must remain off the Electron main thread.'],
  ['semanticContext.js', [/readdirSync\s*\(/, /readFileSync\s*\(/, /require\(['"]web-tree-sitter['"]\)/], 'Semantic parsing must remain inside semanticWorker.js.'],
  ['projectRegistry.js', [/writeFileSync\s*\(\s*REGISTRY_FILE/], 'Project registry persistence must flow through atomic writes.'],
];
for (const [file, patterns, message] of checks) {
  const text = source(file);
  for (const pattern of patterns) if (pattern.test(text)) fail(`${file}: ${message}`);
}

const requiredFiles = [
  'inventoryWorker.js','atomicWrite.js','astEngine.js','workspaceIndexer.js','semanticWorker.js','semanticContext.js',
  'agentOrchestrator.js','toolRegistry.js','CONSTITUTION.md','governanceEngine.js','evalsEngine.js','memoryEngine.js',
];
for (const file of requiredFiles) if (!fs.existsSync(path.join(root, file))) fail(`${file} is required by the Nexus upgrade architecture.`);

if (!/web-tree-sitter/.test(source('astEngine.js'))) fail('astEngine.js must use web-tree-sitter.');
if (!/approvalGate\.request/.test(source('agentOrchestrator.js')) || !/maxCorrections\s*=\s*3/.test(source('agentOrchestrator.js'))) fail('Agent orchestrator must enforce approval and three-correction safety.');
if (!/allowedCapabilities/.test(source('toolRegistry.js')) || !/Path escapes the active workspace/.test(source('toolRegistry.js'))) fail('Tool registry must enforce capabilities and workspace containment.');
if (!/RUNNING_UNVERIFIED/.test(source('governanceEngine.js')) || !/hardKillUsd\s*=\s*5/.test(source('governanceEngine.js'))) fail('Governance engine must enforce truthful unverified state and hard cost cap.');
if (!/securityThreshold\s*=\s*0\.9/.test(source('evalsEngine.js')) || !/passThreshold\s*=\s*0\.8/.test(source('evalsEngine.js'))) fail('Evaluation engine thresholds must remain 0.80 composite / 0.90 security.');
if (!/sourceCommitHash is required/.test(source('memoryEngine.js')) || !/security\/constitution constraints override/.test(source('memoryEngine.js'))) fail('Memory must require accepted provenance and preserve security precedence.');

if (failures) {
  console.error(`Architecture audit failed with ${failures} violation(s).`);
  process.exit(1);
}
console.log('[PASS] Nexus Section 0-6 architecture guardrails verified.');
