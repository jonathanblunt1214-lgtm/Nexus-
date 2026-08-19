// preload.js — this is the ONLY file that gets to bridge the UI (renderer,
// which is basically a webpage) to the real backend (main process). We only
// expose specific, narrow functions — the UI never gets raw Node/filesystem
// access. This is what keeps "run arbitrary HTML" from meaning "run
// arbitrary code with full system access."

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexus', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  resolveProjectPath: (input) => ipcRenderer.invoke('resolve-project-path', { input }),
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
  saveClaudeKey: (key) => ipcRenderer.invoke('save-claude-key', { key }),
  hasClaudeKey: () => ipcRenderer.invoke('has-claude-key'),
  clearClaudeKey: () => ipcRenderer.invoke('clear-claude-key'),
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
  applyFileChange: (filePath, newContent) => ipcRenderer.invoke('apply-file-change', { filePath, newContent }),
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
