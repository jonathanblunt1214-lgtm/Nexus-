// scripts/verifyArchitecture.js
// Regression gate for the consolidated Nexus upgrade through Section 8.

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
  ['agentOrchestrator.js', 'closed-loop orchestration'],
  ['toolRegistry.js', 'capability-scoped tool standardization'],
  ['CONSTITUTION.md', 'AI operational governance'],
  ['governanceEngine.js', 'truthful lifecycle and cost governance'],
  ['evalsEngine.js', 'evaluation gates'],
  ['memoryEngine.js', 'project-scoped semantic memory'],
  ['visualContext.js', 'local-preview visual context'],
  ['runtimeDebugger.js', 'isolated runtime debugging'],
  ['section7Ipc.js', 'narrow vision/debugger IPC bridge'],
  ['pluginManifest.js', 'plugin manifest schema and compatibility validation'],
  ['pluginRuntime.js', 'contained plugin runtime'],
  ['pluginManager.js', 'plugin lifecycle registry, health and audit ledger'],
  ['section8Ipc.js', 'narrow plugin platform IPC bridge'],
  ['bootstrap.js', 'upgrade IPC bootstrap entrypoint'],
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

const agentSource = fs.readFileSync(path.join(__dirname, '..', 'agentOrchestrator.js'), 'utf8');
if (!/approvalGate\.request/.test(agentSource) || !/maxCorrections\s*=\s*3/.test(agentSource)) {
  failures += 1;
  console.error('[FAIL] agentOrchestrator.js must preserve human approval and the three-failure correction limit.');
}

const governanceSource = fs.readFileSync(path.join(__dirname, '..', 'governanceEngine.js'), 'utf8');
if (!/RUNNING_UNVERIFIED/.test(governanceSource) || !/hardKillUsd\s*=\s*5/.test(governanceSource)) {
  failures += 1;
  console.error('[FAIL] governanceEngine.js must preserve truthful unverified state and hard cost cutoff.');
}

const evalSource = fs.readFileSync(path.join(__dirname, '..', 'evalsEngine.js'), 'utf8');
if (!/passThreshold\s*=\s*0\.8/.test(evalSource) || !/securityThreshold\s*=\s*0\.9/.test(evalSource)) {
  failures += 1;
  console.error('[FAIL] evalsEngine.js must preserve composite/security thresholds.');
}

const memorySource = fs.readFileSync(path.join(__dirname, '..', 'memoryEngine.js'), 'utf8');
if (!/sourceCommitHash/.test(memorySource) || !/security\/constitution constraints override/.test(memorySource)) {
  failures += 1;
  console.error('[FAIL] memoryEngine.js must require accepted commit provenance and security precedence.');
}

const visionSource = fs.readFileSync(path.join(__dirname, '..', 'visualContext.js'), 'utf8');
if (!/localhost/.test(visionSource) || !/127\.0\.0\.1/.test(visionSource) || !/untrusted visual evidence/.test(visionSource)) {
  failures += 1;
  console.error('[FAIL] visualContext.js must remain local-preview-only and treat screenshot contents as untrusted.');
}

const debuggerSource = fs.readFileSync(path.join(__dirname, '..', 'runtimeDebugger.js'), 'utf8');
if (!/--inspect=127\.0\.0\.1:0/.test(debuggerSource) || !/process\.pid/.test(debuggerSource) || !/main process is forbidden/.test(debuggerSource)) {
  failures += 1;
  console.error('[FAIL] runtimeDebugger.js must launch isolated loopback inspector targets and forbid Nexus main-process attachment.');
}
if (/inspector\.Session\s*\(/.test(debuggerSource)) {
  failures += 1;
  console.error('[FAIL] runtimeDebugger.js must not attach an inspector.Session to the Nexus process itself.');
}

const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'section7Ipc.js'), 'utf8');
if (!/vision:capture-preview/.test(bridgeSource) || !/debugger:launch-isolated/.test(bridgeSource)) {
  failures += 1;
  console.error('[FAIL] Section 7 IPC must expose only the narrow visual/debugger control surface.');
}

const manifestSource = fs.readFileSync(path.join(__dirname, '..', 'pluginManifest.js'), 'utf8');
if (!/ALLOWED_CAPABILITIES/.test(manifestSource) || !/ALLOWED_SLOTS/.test(manifestSource) || !/minNexusVersion/.test(manifestSource)) {
  failures += 1;
  console.error('[FAIL] pluginManifest.js must enforce capability, slot, and version compatibility declarations.');
}

const pluginRuntimeSource = fs.readFileSync(path.join(__dirname, '..', 'pluginRuntime.js'), 'utf8');
if (!/vm\.createContext/.test(pluginRuntimeSource) || /require:\s*require/.test(pluginRuntimeSource) || /process:\s*process/.test(pluginRuntimeSource)) {
  failures += 1;
  console.error('[FAIL] pluginRuntime.js must keep plugin code in a constrained VM without raw require/process injection.');
}

const pluginManagerSource = fs.readFileSync(path.join(__dirname, '..', 'pluginManager.js'), 'utf8');
if (!/requireSigned\s*=\s*true/.test(pluginManagerSource) || !/verifyManifestSignature/.test(pluginManagerSource) || !/plugin-audit\.jsonl/.test(pluginManagerSource)) {
  failures += 1;
  console.error('[FAIL] pluginManager.js must default to signed plugins and maintain an audit ledger.');
}

const pluginIpcSource = fs.readFileSync(path.join(__dirname, '..', 'section8Ipc.js'), 'utf8');
if (!/plugins:scan/.test(pluginIpcSource) || !/plugins:enable/.test(pluginIpcSource) || !/plugins:disable/.test(pluginIpcSource) || !/plugins:health/.test(pluginIpcSource)) {
  failures += 1;
  console.error('[FAIL] Section 8 IPC must expose the bounded plugin lifecycle surface.');
}

const bootstrapSource = fs.readFileSync(path.join(__dirname, '..', 'bootstrap.js'), 'utf8');
if (!/registerSection7Ipc/.test(bootstrapSource) || !/registerSection8Ipc/.test(bootstrapSource)) {
  failures += 1;
  console.error('[FAIL] bootstrap.js must register both Section 7 and Section 8 IPC boundaries.');
}

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
if (pkg.main !== 'bootstrap.js') {
  failures += 1;
  console.error('[FAIL] package.json must load bootstrap.js so upgrade IPC is registered before main.js.');
}
for (const requiredPackageFile of ['pluginManifest.js','pluginRuntime.js','pluginManager.js','section8Ipc.js']) {
  if ((pkg.build?.files || []).includes(requiredPackageFile)) continue;
  failures += 1;
  console.error(`[FAIL] package.json must package ${requiredPackageFile}.`);
}

if (failures > 0) {
  console.error(`Architecture audit failed with ${failures} violation(s).`);
  process.exit(1);
}

console.log('[PASS] Consolidated Section 0-8 architecture guardrails verified.');
