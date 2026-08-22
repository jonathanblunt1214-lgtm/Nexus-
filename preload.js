// preload.js — this is the ONLY file that gets to bridge the UI (renderer,
// which is basically a webpage) to the real backend (main process). We only
// expose specific, narrow functions — the UI never gets raw Node/filesystem
// access. This is what keeps "run arbitrary HTML" from meaning "run
// arbitrary code with full system access."

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexus', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  exportNexusSetup: (projects) => ipcRenderer.invoke('export-nexus-setup', { projects }),
  importNexusSetup: () => ipcRenderer.invoke('import-nexus-setup'),
  resolveProjectPath: (input) => ipcRenderer.invoke('resolve-project-path', { input }),
  getWorkspaceTrust: (folder) => ipcRenderer.invoke('workspace-trust:get', { folder }),
  setWorkspaceTrust: (folder, permissions) => ipcRenderer.invoke('workspace-trust:set', { folder, permissions }),
  revokeWorkspaceTrust: (folder) => ipcRenderer.invoke('workspace-trust:revoke', { folder }),
  generateNewProject: (name, description) => ipcRenderer.invoke('generate-new-project', { name, description }),
  aiEditFileWithPrompt: (filePath, instruction, folder) => ipcRenderer.invoke('ai-edit-file-with-prompt', { filePath, instruction, folder }),
  searchProject: (folder, query, caseSensitive) => ipcRenderer.invoke('search-project', { folder, query, caseSensitive }),
  replaceInProject: (folder, query, replacement, caseSensitive) => ipcRenderer.invoke('replace-in-project', { folder, query, replacement, caseSensitive }),
  gitDiff: (folder) => ipcRenderer.invoke('git-diff', { folder }),
  detectLintTools: (folder) => ipcRenderer.invoke('detect-lint-tools', { folder }),
  formatAndLintFile: (folder, filePath) => ipcRenderer.invoke('format-and-lint-file', { folder, filePath }),
  gitLog: (folder, limit) => ipcRenderer.invoke('git-log', { folder, limit }),
  gitShowCommit: (folder, hash) => ipcRenderer.invoke('git-show-commit', { folder, hash }),
  detectTestFramework: (folder) => ipcRenderer.invoke('detect-test-framework', { folder }),
  runTestsDetailed: (folder, testNamePattern) => ipcRenderer.invoke('run-tests-detailed', { folder, testNamePattern }),
  apiSendRequest: (method, url, headersText, body) => ipcRenderer.invoke('api-send-request', { method, url, headersText, body }),
  apiLoadCollection: (folder) => ipcRenderer.invoke('api-load-collection', { folder }),
  apiSaveCollection: (folder, requests) => ipcRenderer.invoke('api-save-collection', { folder, requests }),
  dockerCheck: () => ipcRenderer.invoke('docker-check'),
  dockerDetectProject: (folder) => ipcRenderer.invoke('docker-detect-project', { folder }),
  dockerBuild: (folder, tag) => ipcRenderer.invoke('docker-build', { folder, tag }),
  dockerRun: (image, containerName, hostPort, containerPort) => ipcRenderer.invoke('docker-run', { image, containerName, hostPort, containerPort }),
  dockerStop: (containerName) => ipcRenderer.invoke('docker-stop', { containerName }),
  dockerRemove: (containerName) => ipcRenderer.invoke('docker-remove', { containerName }),
  dockerPs: () => ipcRenderer.invoke('docker-ps'),
  dockerStreamLogs: (containerName) => ipcRenderer.invoke('docker-stream-logs', { containerName }),
  dockerStopLogStream: (containerName) => ipcRenderer.invoke('docker-stop-log-stream', { containerName }),
  getBuildInfo: () => ipcRenderer.invoke('get-build-info'),
  checkForSourceUpdates: () => ipcRenderer.invoke('check-for-source-updates'),
  pullSourceUpdates: () => ipcRenderer.invoke('pull-source-updates'),
  restartNexus: () => ipcRenderer.invoke('restart-nexus'),
  runPipelineQuery: (input, context) => ipcRenderer.invoke('run-pipeline-query', { input, context }),
  npmListDeps: (folder) => ipcRenderer.invoke('npm-list-deps', { folder }),
  npmCheckOutdated: (folder) => ipcRenderer.invoke('npm-check-outdated', { folder }),
  npmInstallPackage: (opId, folder, packageName, version, isDev) => ipcRenderer.invoke('npm-install-package', { opId, folder, packageName, version, isDev }),
  npmUninstallPackage: (opId, folder, packageName) => ipcRenderer.invoke('npm-uninstall-package', { opId, folder, packageName }),
  npmUpdatePackage: (opId, folder, packageName) => ipcRenderer.invoke('npm-update-package', { opId, folder, packageName }),
  onNpmOpLog: (callback) => ipcRenderer.on('npm-op-log', (_e, payload) => callback(payload)),
  onNpmOpDone: (callback) => ipcRenderer.on('npm-op-done', (_e, payload) => callback(payload)),
  onMainProcessError: (callback) => ipcRenderer.on('main-process-error', (_e, payload) => callback(payload)),
  onDockerBuildLog: (callback) => ipcRenderer.on('docker-build-log', (_e, payload) => callback(payload)),
  onDockerBuildDone: (callback) => ipcRenderer.on('docker-build-done', (_e, payload) => callback(payload)),
  onDockerContainerLog: (callback) => ipcRenderer.on('docker-container-log', (_e, payload) => callback(payload)),
  clearPreviewCache: () => ipcRenderer.invoke('clear-preview-cache'),
  onProjectCloneLog: (callback) => ipcRenderer.on('project-clone-log', (_e, payload) => callback(payload)),

  // Auto-updater: checks Nexus's own GitHub repo Releases for newer builds
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdateAndRestart: () => ipcRenderer.invoke('updater:install'),
  getUpdaterStatus: () => ipcRenderer.invoke('updater:status'),
  onUpdaterStatus: (callback) => ipcRenderer.on('updater:status', (_e, payload) => callback(payload)),

  execCommand: (cmd) => ipcRenderer.invoke('exec-command', { cmd }),
  getCwd: () => ipcRenderer.invoke('get-cwd'),

  launchProject: (id, folder, command, port, projectUid, sandboxed) =>
    ipcRenderer.invoke('launch-project', { id, folder, command, port, projectUid, sandboxed }),
  stopProject: (id) => ipcRenderer.invoke('stop-project', { id }),
  isProjectRunning: (id) => ipcRenderer.invoke('is-project-running', { id }),
  onProjectLog: (callback) =>
    ipcRenderer.on('project-log', (_e, payload) => callback(payload)),
  onProjectClosed: (callback) =>
    ipcRenderer.on('project-closed', (_e, payload) => callback(payload)),

  openExternal: (url) => ipcRenderer.invoke('open-external', { url }),

  saveGeminiKey: (key) => ipcRenderer.invoke('save-gemini-key', { key }),
  hasGeminiKey: () => ipcRenderer.invoke('has-gemini-key'),
  clearGeminiKey: () => ipcRenderer.invoke('clear-gemini-key'),
  saveNimKey: (key) => ipcRenderer.invoke('save-nim-key', { key }),
  hasNimKey: () => ipcRenderer.invoke('has-nim-key'),
  clearNimKey: () => ipcRenderer.invoke('clear-nim-key'),
  saveGcpProject: (projectId) => ipcRenderer.invoke('save-gcp-project', { projectId }),
  getGcpProject: () => ipcRenderer.invoke('get-gcp-project'),
  geminiAsk: (prompt, folder) => ipcRenderer.invoke('gemini-ask', { prompt, folder }),
  saveOpenaiKey: (key) => ipcRenderer.invoke('save-openai-key', { key }),
  hasOpenaiKey: () => ipcRenderer.invoke('has-openai-key'),
  clearOpenaiKey: () => ipcRenderer.invoke('clear-openai-key'),
  openaiAsk: (prompt, folder) => ipcRenderer.invoke('openai-ask', { prompt, folder }),

  // Code assist — proposals only pass through the renderer; the actual
  // write path (apply-file-change) is the single choke point for any
  // file mutation, so the UI is where the approve/reject gate lives.
  listProjectFiles: (folder) => ipcRenderer.invoke('list-project-files', { folder }),
  getAppDir: () => ipcRenderer.invoke('get-app-dir'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', { filePath }),
  languageIntelligence: (payload) => ipcRenderer.invoke('language-intelligence', payload),
  aiProposeFix: (filePath, errorText, folder) => ipcRenderer.invoke('ai-propose-fix', { filePath, errorText, folder }),
  applyFileChange: (filePath, newContent, source) => ipcRenderer.invoke('apply-file-change', { filePath, newContent, source }),
  getRecentChanges: () => ipcRenderer.invoke('get-recent-changes'),
  revertChange: (filePath, backupPath) => ipcRenderer.invoke('revert-change', { filePath, backupPath }),
  aiSuggestFeatures: (folder) => ipcRenderer.invoke('ai-suggest-features', { folder }),

  // Ship: git actions, deploy runner, feature planner
  gitStatus: (folder) => ipcRenderer.invoke('git-status', { folder }),
  gitCreateBranch: (folder, branchName) => ipcRenderer.invoke('git-create-branch', { folder, branchName }),
  gitCommit: (folder, message) => ipcRenderer.invoke('git-commit', { folder, message }),
  gitPush: (folder) => ipcRenderer.invoke('git-push', { folder }),
  gitWorkflowStatus: (folder) => ipcRenderer.invoke('git-workflow-status', { folder }),
  gitStagePaths: (folder, paths) => ipcRenderer.invoke('git-stage-paths', { folder, paths }),
  gitUnstagePaths: (folder, paths) => ipcRenderer.invoke('git-unstage-paths', { folder, paths }),
  gitListBranches: (folder) => ipcRenderer.invoke('git-list-branches', { folder }),
  gitSwitchBranch: (folder, branch) => ipcRenderer.invoke('git-switch-branch', { folder, branch }),
  gitListStashes: (folder) => ipcRenderer.invoke('git-list-stashes', { folder }),
  gitStashAction: (folder, action, ref, message) => ipcRenderer.invoke('git-stash-action', { folder, action, ref, message }),
  gitHistoryAction: (folder, action, hash) => ipcRenderer.invoke('git-history-action', { folder, action, hash }),
  gitConflictDetails: (folder, file) => ipcRenderer.invoke('git-conflict-details', { folder, file }),
  gitResolveConflict: (folder, file, content) => ipcRenderer.invoke('git-resolve-conflict', { folder, file, content }),
  gitAbortOperation: (folder, action) => ipcRenderer.invoke('git-abort-operation', { folder, action }),
  gitBranchProtection: (folder) => ipcRenderer.invoke('git-branch-protection', { folder }),
  githubProjectPRs: (folder, state) => ipcRenderer.invoke('github-project-prs', { folder, state }),
  githubProjectPRReview: (folder, number) => ipcRenderer.invoke('github-project-pr-review', { folder, number }),
  githubProjectPRSubmitReview: (folder, number, body, action) => ipcRenderer.invoke('github-project-pr-submit-review', { folder, number, body, action }),
  githubProjectPRMerge: (folder, number, method) => ipcRenderer.invoke('github-project-pr-merge', { folder, number, method }),
  gitAutoSync: (folder, projectName) => ipcRenderer.invoke('git-auto-sync', { folder, projectName }),
  setProjectsForExitSync: (projects) => ipcRenderer.send('set-projects-for-exit-sync', { projects }),
  onExitSyncStatus: (callback) => ipcRenderer.on('exit-sync-status', (_e, payload) => callback(payload)),
  onExitSaveRequest: (callback) => ipcRenderer.on('exit-save-request', (_e, payload) => callback(payload)),
  completeExitSave: (requestId, result) => ipcRenderer.send('exit-save-complete', { requestId, result }),
  runDeploy: (id, folder, command) => ipcRenderer.invoke('run-deploy', { id, folder, command }),
  onDeployLog: (callback) => ipcRenderer.on('deploy-log', (_e, payload) => callback(payload)),
  onDeployClosed: (callback) => ipcRenderer.on('deploy-closed', (_e, payload) => callback(payload)),
  aiPlanFeature: (folder, description) => ipcRenderer.invoke('ai-plan-feature', { folder, description }),
  aiProposeFeatureFile: (folder, filePath, description, planContext) =>
    ipcRenderer.invoke('ai-propose-feature-file', { folder, filePath, description, planContext }),
  runFeaturePlanAutonomous: (folder, plan, description) =>
    ipcRenderer.invoke('run-feature-plan-autonomous', { folder, plan, description }),
  aiGenerateChangelog: (changes) => ipcRenderer.invoke('ai-generate-changelog', { changes }),
  appendChangelog: (folder, devEntry, userEntry) =>
    ipcRenderer.invoke('append-changelog', { folder, devEntry, userEntry }),

  // Per-project config & secrets (real UID, encrypted-at-rest, no plaintext fallback)
  ensureProjectConfig: (folder) => ipcRenderer.invoke('ensure-project-config', { folder }),
  saveProjectSecret: (projectUid, key, value) => ipcRenderer.invoke('save-project-secret', { projectUid, key, value }),
  listProjectSecrets: (projectUid) => ipcRenderer.invoke('list-project-secrets', { projectUid }),
  revealProjectSecret: (projectUid, key) => ipcRenderer.invoke('reveal-project-secret', { projectUid, key }),
  deleteProjectSecret: (projectUid, key) => ipcRenderer.invoke('delete-project-secret', { projectUid, key }),
  exportSecretsToEnv: (folder, projectUid) => ipcRenderer.invoke('export-secrets-to-env', { folder, projectUid }),
  scanIntegrations: (folder) => ipcRenderer.invoke('scan-integrations', { folder }),

  // Services: real process control plane, no optimistic states
  startService: (projectId, name, folder, command, healthCheckUrl, projectUid) =>
    ipcRenderer.invoke('start-service', { projectId, name, folder, command, healthCheckUrl, projectUid }),
  stopService: (projectId, name) => ipcRenderer.invoke('stop-service', { projectId, name }),
  getServiceState: (projectId, name) => ipcRenderer.invoke('get-service-state', { projectId, name }),
  onServiceState: (callback) => ipcRenderer.on('service-state', (_e, payload) => callback(payload)),
  onServiceLog: (callback) => ipcRenderer.on('service-log', (_e, payload) => callback(payload)),

  // Audit -> Repair -> Test -> Gate pipeline
  runAudit: (folder) => ipcRenderer.invoke('run-audit', { folder }),
  runAuditFix: (folder) => ipcRenderer.invoke('run-audit-fix', { folder }),
  runTests: (folder) => ipcRenderer.invoke('run-tests', { folder }),
  readConstitution: (folder) => ipcRenderer.invoke('read-constitution', { folder }),
  saveConstitution: (folder, content) => ipcRenderer.invoke('save-constitution', { folder, content }),

  // GitHub integration (personal access token path)
  saveGitHubToken: (token) => ipcRenderer.invoke('save-github-token', { token }),
  hasGitHubToken: () => ipcRenderer.invoke('has-github-token'),
  clearGitHubToken: () => ipcRenderer.invoke('clear-github-token'),
  githubListRepos: () => ipcRenderer.invoke('github-list-repos'),
  githubGetFile: (owner, repo, path, ref) => ipcRenderer.invoke('github-get-file', { owner, repo, path, ref }),
  githubPutFile: (owner, repo, path, content, message, branch, sha) =>
    ipcRenderer.invoke('github-put-file', { owner, repo, path, content, message, branch, sha }),
  githubCreatePR: (owner, repo, title, body, head, base) =>
    ipcRenderer.invoke('github-create-pr', { owner, repo, title, body, head, base }),
  githubListPRs: (owner, repo, state) => ipcRenderer.invoke('github-list-prs', { owner, repo, state }),
  githubCreateBranch: (owner, repo, branch, fromBranch) =>
    ipcRenderer.invoke('github-create-branch', { owner, repo, branch, fromBranch }),
  githubGetCommits: (owner, repo, branch, per_page) =>
    ipcRenderer.invoke('github-get-commits', { owner, repo, branch, per_page }),

  // AI Improvement Framework: inventory, metrics, guardrail testing, guarded
  // upgrades, prompt testing, dependency auditing, compliance, changelog,
  // knowledge base, experiments - see aiFramework* modules in main.js.
  aiFwScanInventory: (folder) => ipcRenderer.invoke('ai-fw-scan-inventory', { folder }),
  aiFwRecordMetric: (folder, event) => ipcRenderer.invoke('ai-fw-record-metric', { folder, event }),
  aiFwMetricsSummary: (folder) => ipcRenderer.invoke('ai-fw-metrics-summary', { folder }),
  aiFwMetricsHistory: (folder, limit) => ipcRenderer.invoke('ai-fw-metrics-history', { folder, limit }),
  aiFwRunGuardrails: (folder) => ipcRenderer.invoke('ai-fw-run-guardrails', { folder }),
  aiFwGuardrailHistory: (folder, limit) => ipcRenderer.invoke('ai-fw-guardrail-history', { folder, limit }),
  aiFwPlanUpgrade: (folder, options) => ipcRenderer.invoke('ai-fw-plan-upgrade', { folder, options }),
  aiFwApplyUpgrade: (folder, options) => ipcRenderer.invoke('ai-fw-apply-upgrade', { folder, options }),
  aiFwUpgradeHistory: (folder, limit) => ipcRenderer.invoke('ai-fw-upgrade-history', { folder, limit }),
  aiFwSavePromptVariant: (folder, variant) => ipcRenderer.invoke('ai-fw-save-prompt-variant', { folder, variant }),
  aiFwRecordPromptResult: (folder, variantName, result) => ipcRenderer.invoke('ai-fw-record-prompt-result', { folder, variantName, result }),
  aiFwComparePrompts: (folder) => ipcRenderer.invoke('ai-fw-compare-prompts', { folder }),
  aiFwAuditDependencies: (folder) => ipcRenderer.invoke('ai-fw-audit-dependencies', { folder }),
  aiFwComplianceStatus: (folder) => ipcRenderer.invoke('ai-fw-compliance-status', { folder }),
  aiFwLogViolation: (folder, violation) => ipcRenderer.invoke('ai-fw-log-violation', { folder, violation }),
  aiFwGenerateChangelog: (folder, limit) => ipcRenderer.invoke('ai-fw-generate-changelog', { folder, limit }),
  aiFwKnowledgeAdd: (entry) => ipcRenderer.invoke('ai-fw-knowledge-add', { entry }),
  aiFwKnowledgeSearch: (query) => ipcRenderer.invoke('ai-fw-knowledge-search', { query }),
  aiFwKnowledgeList: () => ipcRenderer.invoke('ai-fw-knowledge-list'),
  aiFwCreateExperiment: (folder, experiment) => ipcRenderer.invoke('ai-fw-create-experiment', { folder, experiment }),
  aiFwRecordObservation: (folder, observation) => ipcRenderer.invoke('ai-fw-record-observation', { folder, observation }),
  aiFwAnalyzeExperiment: (folder, name) => ipcRenderer.invoke('ai-fw-analyze-experiment', { folder, name }),
  aiFwListExperiments: (folder) => ipcRenderer.invoke('ai-fw-list-experiments', { folder }),

  // Recommendations, trend alerts, cost, and performance tuning - built on
  // top of the real data recorded by the modules above.
  aiFwGetRecommendations: (folder) => ipcRenderer.invoke('ai-fw-get-recommendations', { folder }),
  aiFwGetTrendAlerts: (folder) => ipcRenderer.invoke('ai-fw-get-trend-alerts', { folder }),
  aiFwSetPricing: (folder, model, pricePerMillionIn, pricePerMillionOut) => ipcRenderer.invoke('ai-fw-set-pricing', { folder, model, pricePerMillionIn, pricePerMillionOut }),
  aiFwGetPricing: (folder) => ipcRenderer.invoke('ai-fw-get-pricing', { folder }),
  aiFwEstimateCosts: (folder) => ipcRenderer.invoke('ai-fw-estimate-costs', { folder }),
  aiFwPerformanceProfile: (folder) => ipcRenderer.invoke('ai-fw-performance-profile', { folder }),

  // Project capabilities (TS/React/Vite/Express/Firebase/Capacitor
  // detection + this project's own real mobile/Firebase npm scripts).
  scanFullStackConfig: (folder) => ipcRenderer.invoke('scan-full-stack-config', { folder }),

  // Real per-language byte breakdown for a project folder (GitHub
  // repository "Languages" bar equivalent).
  scanLanguages: (folder) => ipcRenderer.invoke('scan-languages', { folder }),

  // Section 8: signed plugin platform. Project-root authorization is rechecked
  // in the main process; the renderer receives only narrow lifecycle calls.
  pluginsScan: (projectRoot) => ipcRenderer.invoke('plugins:scan', { projectRoot }),
  pluginsList: (projectRoot) => ipcRenderer.invoke('plugins:list', { projectRoot }),
  pluginsEnable: (projectRoot, pluginId) => ipcRenderer.invoke('plugins:enable', { projectRoot, pluginId }),
  pluginsDisable: (projectRoot, pluginId) => ipcRenderer.invoke('plugins:disable', { projectRoot, pluginId }),
  pluginsSlots: (projectRoot) => ipcRenderer.invoke('plugins:slots', { projectRoot }),
  pluginsHealth: (projectRoot) => ipcRenderer.invoke('plugins:health', { projectRoot }),
  pluginsInvokeSlot: (projectRoot, slot, payload) => ipcRenderer.invoke('plugins:invoke-slot', { projectRoot, slot, payload }),

  // Section 7: local-preview vision and isolated runtime debugging only.
  visionCapturePreview: (webContentsId, rect) => ipcRenderer.invoke('vision:capture-preview', { webContentsId, rect }),
  visionPrepareContext: (payload) => ipcRenderer.invoke('vision:prepare-context', payload),
  debuggerLaunchIsolated: (folder, scriptPath, args) => ipcRenderer.invoke('debugger:launch-isolated', { folder, scriptPath, args }),
  debuggerGetTarget: (folder, targetId) => ipcRenderer.invoke('debugger:get-target', { folder, targetId }),
  debuggerPrepareEvaluation: (folder, targetId, pid, expression) => ipcRenderer.invoke('debugger:prepare-evaluation', { folder, targetId, pid, expression }),
  debuggerStop: (folder, targetId) => ipcRenderer.invoke('debugger:stop', { folder, targetId }),
  debuggerConnect: (folder, targetId) => ipcRenderer.invoke('debugger:connect', { folder, targetId }),
  debuggerAttachLocal: (folder, pid, debugUrl) => ipcRenderer.invoke('debugger:attach-local', { folder, pid, debugUrl }),
  debuggerSnapshot: (folder, targetId) => ipcRenderer.invoke('debugger:snapshot', { folder, targetId }),
  debuggerSetBreakpoint: (folder, targetId, url, line, column, condition) => ipcRenderer.invoke('debugger:set-breakpoint', { folder, targetId, url, line, column, condition }),
  debuggerRemoveBreakpoint: (folder, targetId, breakpointId) => ipcRenderer.invoke('debugger:remove-breakpoint', { folder, targetId, breakpointId }),
  debuggerControl: (folder, targetId, action) => ipcRenderer.invoke('debugger:control', { folder, targetId, action }),
  debuggerExceptionMode: (folder, targetId, mode) => ipcRenderer.invoke('debugger:exception-mode', { folder, targetId, mode }),
  debuggerProperties: (folder, targetId, objectId) => ipcRenderer.invoke('debugger:properties', { folder, targetId, objectId }),
  debuggerEvaluate: (folder, targetId, callFrameId, expression) => ipcRenderer.invoke('debugger:evaluate', { folder, targetId, callFrameId, expression }),
  debuggerDapStart: (folder, command, args, adapterId, configuration) => ipcRenderer.invoke('debugger:dap-start', { folder, command, args, adapterId, configuration }),
  debuggerDapRequest: (sessionId, method, args) => ipcRenderer.invoke('debugger:dap-request', { sessionId, method, args }),
  debuggerDapStop: (sessionId) => ipcRenderer.invoke('debugger:dap-stop', { sessionId }),
});
