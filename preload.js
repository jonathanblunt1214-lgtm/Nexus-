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
  onUpdaterStatus: (callback) => ipcRenderer.on('updater:status', (_e, payload) => callback(payload)),

  execCommand: (cmd) => ipcRenderer.invoke('exec-command', { cmd }),
  getCwd: () => ipcRenderer.invoke('get-cwd'),

  launchProject: (id, folder, command, port, projectUid) =>
    ipcRenderer.invoke('launch-project', { id, folder, command, port, projectUid }),
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
  geminiAsk: (prompt) => ipcRenderer.invoke('gemini-ask', { prompt }),

  // Code assist — proposals only pass through the renderer; the actual
  // write path (apply-file-change) is the single choke point for any
  // file mutation, so the UI is where the approve/reject gate lives.
  listProjectFiles: (folder) => ipcRenderer.invoke('list-project-files', { folder }),
  getAppDir: () => ipcRenderer.invoke('get-app-dir'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', { filePath }),
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
  runDeploy: (id, folder, command) => ipcRenderer.invoke('run-deploy', { id, folder, command }),
  onDeployLog: (callback) => ipcRenderer.on('deploy-log', (_e, payload) => callback(payload)),
  onDeployClosed: (callback) => ipcRenderer.on('deploy-closed', (_e, payload) => callback(payload)),
  aiPlanFeature: (folder, description) => ipcRenderer.invoke('ai-plan-feature', { folder, description }),
  aiProposeFeatureFile: (folder, filePath, description, planContext) =>
    ipcRenderer.invoke('ai-propose-feature-file', { folder, filePath, description, planContext }),
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
});
// Add these to the window.nexus exports

// GitHub integration
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
