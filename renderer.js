// renderer.js — runs in the UI. It has NO direct filesystem/process access;
// everything real happens through window.nexus (exposed by preload.js),
// which forwards to main.js. localStorage here is only used to remember
// your project list between launches — it is not standing in for real work.

// ---------- Docked tool trays ----------
// Code Editor, API Tester, Docker, Package Manager, Recent Changes, Object
// Pipeline, AI Tools, and Activity all dock in the same single slot next to
// the sidebar (see .tray-overlay in index.html) - #main-container reflows
// to fill whatever space is left. Only one can be docked at a time, so
// opening one closes whichever other tray was already open.
const TRAY_OVERLAY_IDS = ['pipeline-overlay', 'aitools-overlay', 'activity-overlay', 'recentchanges-overlay', 'pkgmgr-overlay', 'docker-overlay', 'api-tester-overlay', 'code-editor-overlay'];
function dockTray(overlayId) {
  for (const id of TRAY_OVERLAY_IDS) {
    if (id !== overlayId) document.getElementById(id).classList.remove('open');
  }
  document.getElementById(overlayId).classList.add('open');
}

// ---------- Global toast notifications ----------
// Started as error-only surfacing (see below), now generalized to a real
// success/info/error toast system, so routine feedback ("Committed and
// pushed," "Package installed") no longer needs a blocking native alert()
// that visually clashes with the rest of the app. Blocking confirm()
// dialogs are intentionally left alone - those need a real yes/no answer
// before continuing, which a toast can't provide.
function showToast(type, title, message) {
  const container = document.getElementById('error-toast-container');
  if (!container) { console.log(`[${type}] ${title}`, message); return; } // page not ready yet
  const icon = type === 'error' ? '⚠' : type === 'success' ? '✓' : 'ℹ';
  const toast = document.createElement('div');
  toast.className = `error-toast toast-${type}`;
  const messageText = message || (type === 'error' ? '(no further detail)' : '');
  toast.innerHTML = `
    <div class="error-toast-title">
      <span>${icon} ${escapeHtml(title)}</span>
      <span class="error-toast-dismiss">✕</span>
    </div>
    ${messageText ? `<div class="error-toast-message">${escapeHtml(messageText)}</div>` : ''}
  `;
  toast.addEventListener('click', () => toast.remove());
  container.appendChild(toast);
  setTimeout(() => toast.remove(), type === 'error' ? 10000 : 5000);
  window.nexus?.diagnosticsRecord?.({ level: type === 'error' ? 'error' : 'info', component: 'ui', event: title, data: { message: messageText } }).catch(() => {});
}

async function loadDiagnostics() { const r = await window.nexus.diagnosticsGet(300); if (!r.ok) return; document.getElementById('diagnostics-telemetry').checked = r.settings.telemetry; document.getElementById('diagnostics-paths').checked = r.settings.includePaths; document.getElementById('diagnostics-log').innerHTML = r.entries.slice().reverse().map((entry) => `<p class="small mono">${escapeHtml(entry.timestamp)} · ${escapeHtml(entry.level)} · ${escapeHtml(entry.component)} · ${escapeHtml(entry.event)} · ${escapeHtml(entry.data?.message || '')} · ${escapeHtml(entry.correlationId)}</p>`).join('') || '<p class="muted small">No diagnostics recorded yet.</p>'; }
async function refreshLanguageServices() {
  const panel = document.getElementById('language-services-list'); if (!panel) return;
  const result = await window.nexus.languageServicesStatus();
  if (!result.ok) { panel.innerHTML = `<p class="muted small">${escapeHtml(result.error)}</p>`; return; }
  panel.innerHTML = result.providers.map((provider) => `<div class="suggestion-item"><strong>${escapeHtml(provider.name)}</strong><span class="muted small">${escapeHtml(provider.license)} · ${provider.bundled ? 'Included with Nexus' : provider.configured ? 'Local path configured' : 'Local installation required'}</span><span class="muted small">Languages: ${escapeHtml(provider.extensions.join(', '))}</span></div>`).join('');
}
async function chooseLanguageService(provider) {
  const result = await window.nexus.chooseLanguageService(provider);
  if (result.ok) showToast('success', 'Language service connected', 'Nexus will use this local first-party service in trusted workspaces.');
  else if (!result.canceled) showToast('error', 'Language service was not connected', result.error);
  refreshLanguageServices();
}
async function saveDiagnosticsSettings() { const r = await window.nexus.diagnosticsSettings({ telemetry: document.getElementById('diagnostics-telemetry').checked, includePaths: document.getElementById('diagnostics-paths').checked }); showToast(r.ok ? 'success' : 'error', r.ok ? 'Privacy settings saved' : 'Could not save settings', r.error || ''); }
async function exportDiagnosticsBundle() { const r = await window.nexus.diagnosticsExport(); if (!r.canceled) showToast(r.ok ? 'success' : 'error', r.ok ? 'Support bundle exported' : 'Export failed', r.path || r.error); }

// Previously, an uncaught exception or a rejected promise anywhere in this
// file (or in main.js) would fail completely silently unless DevTools
// happened to be open. This makes every such error visible immediately, as
// a dismissible toast, instead of leaving you staring at a blank panel with
// no idea why. Errors stack rather than replace each other.
function showErrorToast(title, message) {
  showToast('error', title, message);
}

window.addEventListener('error', (event) => {
  showErrorToast('Unexpected error', event.error?.message || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  showErrorToast('Unhandled promise rejection', reason instanceof Error ? reason.message : String(reason));
});
window.nexus.onMainProcessError(({ message }) => {
  showErrorToast('Main process error', message);
});
window.nexus.onExitSyncStatus(({ state, message }) => {
  showToast(state === 'failed' ? 'error' : 'info', state === 'failed' ? 'Close blocked' : 'Syncing before close', message);
});

// ---------- Saved project list: schema versioning ----------
// Project objects have gained new fields many times as Nexus grew
// (projectUid, services, deployCommand...). The encrypted config already
// has CONFIG_SCHEMA_VERSION for exactly this reason - this gives the
// project list the same protection, so a future shape change can't
// silently corrupt or drop someone's saved projects. Malformed entries are
// dropped with a visible warning rather than crashing the whole list; safe
// defaults are filled in for genuinely optional fields; identity fields
// like projectUid are never fabricated here - they're real backend-issued
// values, left alone or created later by ensureActiveProjectConfig().
const PROJECTS_SCHEMA_VERSION = 2;

function migrateProjects(rawProjects) {
  if (!Array.isArray(rawProjects)) return [];
  const migrated = [];
  for (const p of rawProjects) {
    if (!p || typeof p !== 'object' || !p.id || !p.name || !p.folder) {
      console.error('Nexus: dropped a malformed saved project entry (missing required fields):', p);
      continue;
    }
    migrated.push({
      id: p.id,
      name: p.name,
      folder: p.folder,
      command: p.command || 'npm run dev',
      port: p.port || '3000',
      // Never trust a persisted "running" state - no spawned process
      // actually survives an app restart, so this was a real latent bug:
      // a project could show as RUNNING on a fresh launch when nothing
      // was actually alive.
      running: false,
      deployCommand: p.deployCommand || '',
      services: Array.isArray(p.services) ? p.services : [],
      projectUid: p.projectUid || undefined,
      templateId: ['website','app','api'].includes(p.templateId) ? p.templateId : undefined,
      sandboxed: p.sandboxed === true,
      accountLinked: p.accountLinked === true,
      accountProjectId: p.accountProjectId || undefined,
      accountRepositoryUrl: p.accountRepositoryUrl || undefined,
      accountSourceProvider: p.accountSourceProvider || undefined,
      accountLinkedAt: p.accountLinkedAt || undefined,
    });
  }
  return migrated;
}

function loadProjects() {
  const storedVersion = parseInt(localStorage.getItem('nexus_projects_schema_version') || '0', 10);
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem('nexus_projects') || '[]');
  } catch (err) {
    console.error('Nexus: saved project list was corrupted JSON, starting fresh:', err);
    showErrorToast('Saved project list was corrupted', 'Starting with an empty list - nothing on disk was touched, only the local project list.');
    raw = [];
  }

  const migrated = migrateProjects(raw);
  if (migrated.length < raw.length) {
    showErrorToast(
      'Some saved projects were dropped',
      `${raw.length - migrated.length} saved project entr${raw.length - migrated.length === 1 ? 'y was' : 'ies were'} malformed and could not be loaded. See DevTools console for details.`
    );
  }

  if (storedVersion !== PROJECTS_SCHEMA_VERSION || migrated.length !== raw.length) {
    localStorage.setItem('nexus_projects', JSON.stringify(migrated));
    localStorage.setItem('nexus_projects_schema_version', String(PROJECTS_SCHEMA_VERSION));
  }

  return migrated;
}

let projects = loadProjects();
let activeProjectId = JSON.parse(localStorage.getItem('nexus_active') || 'null');
if (activeProjectId !== null && !projects.some((p) => p.id === activeProjectId)) {
  // The previously-active project no longer exists (removed, or dropped
  // during migration above) - don't carry forward a dangling reference.
  activeProjectId = null;
}
let openConfigProjectId = null; // which project's config panel is currently expanded, if any
window.nexus.setProjectsForExitSync(projects);

// ---------- Tabs ----------
// ---------- Workspace grid resizers ----------
// Two independent drags: the vertical divider moves the column split
// (Preview/Ship on the left vs Terminal/Assist on the right), the two
// horizontal dividers move the row split (top vs bottom) together, since
// they're really one logical divider split into two DOM pieces so the
// vertical divider can pass through the middle without overlapping them.
function initWorkspaceResizers() {
  const grid = document.getElementById('workspace-grid');
  if (!grid) return;

  // Restore the last saved layout, falling back to 50/50 if nothing was
  // saved yet or the saved value is corrupt/out of range - this was a real
  // daily papercut before: the divider position reset to 50/50 every
  // single launch, unlike any real IDE that remembers panel sizes.
  function loadSavedFraction(key, fallback) {
    const raw = localStorage.getItem(key);
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0.15 || parsed > 0.85) return fallback;
    return parsed;
  }

  let colFraction = loadSavedFraction('nexus_workspace_col_fraction', 0.5);
  let rowFraction = loadSavedFraction('nexus_workspace_row_fraction', 0.5);

  function applyGrid() {
    grid.style.gridTemplateColumns = `${colFraction}fr 6px ${1 - colFraction}fr`;
    grid.style.gridTemplateRows = `${rowFraction}fr 6px ${1 - rowFraction}fr`;
  }

  // Debounced save - writes to localStorage a moment after dragging stops,
  // not on every single mousemove event during the drag itself.
  let saveTimer = null;
  function saveLayoutSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem('nexus_workspace_col_fraction', String(colFraction));
      localStorage.setItem('nexus_workspace_row_fraction', String(rowFraction));
    }, 300);
  }

  function startDrag(resizerEl, onMove) {
    resizerEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      resizerEl.classList.add('dragging');
      const onMouseMove = (moveEvent) => { onMove(moveEvent); saveLayoutSoon(); };
      const onMouseUp = () => {
        resizerEl.classList.remove('dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  const resizerV = document.getElementById('resizer-v');
  startDrag(resizerV, (e) => {
    const rect = grid.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    colFraction = Math.min(0.85, Math.max(0.15, fraction));
    applyGrid();
  });

  [document.getElementById('resizer-h-left'), document.getElementById('resizer-h-right')].forEach((el) => {
    startDrag(el, (e) => {
      const rect = grid.getBoundingClientRect();
      const fraction = (e.clientY - rect.top) / rect.height;
      rowFraction = Math.min(0.85, Math.max(0.15, fraction));
      applyGrid();
    });
  });

  applyGrid();
}

initWorkspaceResizers();

// ---------- Command Palette ----------
// Ctrl+K (Cmd+K on Mac) from anywhere in the app. Every entry calls a real,
// already-existing function - nothing here is a placeholder that "will be
// wired up later." Some entries switch to the relevant tab/panel first, so
// the result of the action is actually visible.
function fakeEvent() { return { stopPropagation: () => {} }; }

function getCommandList() {
  const active = projects.find((p) => p.id === activeProjectId);
  return [
    { label: 'Go to Projects', category: 'Navigate', keywords: 'projects dashboard', action: () => switchTab('projects') },
    { label: 'Go to Workspace', category: 'Navigate', keywords: 'terminal preview ship assist workspace', action: () => switchTab('workspace') },
    { label: 'Go to Cloud / API Keys', category: 'Navigate', keywords: 'nim nvidia gemini cloud keys', action: () => switchTab('cloud') },
    { label: 'Export Nexus Setup', category: 'Navigate', keywords: 'backup export projects move machine', action: () => { switchTab('cloud'); exportNexusSetupUI(); } },
    { label: 'Import Nexus Setup', category: 'Navigate', keywords: 'restore import projects move machine', action: () => { switchTab('cloud'); importNexusSetupUI(); } },
    { label: 'Open Code Editor', category: 'Navigate', keywords: 'code editor files manual edit', action: () => toggleCodeEditor() },
    { label: 'Open API Tester', category: 'Navigate', keywords: 'api http postman request test', action: () => toggleApiTester() },
    { label: 'Open Docker', category: 'Navigate', keywords: 'docker container build run', action: () => toggleDockerPanel() },
    { label: 'Open Package Manager', category: 'Navigate', keywords: 'npm install uninstall update dependencies', action: () => togglePackageManager() },
    { label: 'Open Recent Changes', category: 'Navigate', keywords: 'revert undo history backup bak', action: () => toggleRecentChanges() },
    { label: 'Open Activity', category: 'Navigate', keywords: 'running processes docker npm status', action: () => toggleActivityView() },
    { label: 'Check for Nexus Updates (pull from GitHub)', category: 'Navigate', keywords: 'sync update pull refresh source', action: () => checkForUpdatesNow() },
    { label: 'Open Object Pipeline', category: 'Navigate', keywords: 'powershell query data pipe', action: () => togglePipelinePanel() },
    { label: 'Open AI Tools', category: 'Navigate', keywords: 'ai inventory metrics guardrails upgrade prompt experiment', action: () => toggleAIToolsPanel() },
    { label: 'Search across project files', category: 'Navigate', keywords: 'find search replace grep', action: async () => { await toggleCodeEditor(); showCodeEditorSearch(); } },

    { label: 'Add a Project (folder or GitHub URL)', category: 'Projects', keywords: 'clone add new local github', action: () => { switchTab('projects'); setTimeout(() => document.getElementById('project-path')?.focus(), 100); } },
    { label: 'Create New Project from a Prompt', category: 'Projects', keywords: 'generate ai scaffold new', action: () => { switchTab('projects'); setTimeout(() => document.getElementById('new-project-description')?.focus(), 100); } },
    { label: active ? `Launch/Stop ${active.name}` : 'Launch/Stop active project', category: 'Projects', keywords: 'run start stop dev server', action: () => { if (!active) { alert('No active project.'); return; } toggleProject(active.id, fakeEvent()); } },
    { label: active ? `Open ${active.name} Config` : 'Open project Config', category: 'Projects', keywords: 'secrets services constitution integrations', action: () => { if (!active) { alert('No active project.'); return; } switchTab('projects'); toggleProjectConfig(active.id, fakeEvent()); } },

    { label: 'Refresh Git Status', category: 'Ship / Git', keywords: 'git status branch', action: () => { switchTab('workspace'); refreshGitStatus(); } },
    { label: 'Commit & Push', category: 'Ship / Git', keywords: 'git commit push save', action: () => { switchTab('workspace'); setTimeout(() => document.getElementById('git-commit-message')?.focus(), 100); } },
    { label: 'Create Branch', category: 'Ship / Git', keywords: 'git branch checkout', action: () => { switchTab('workspace'); setTimeout(() => document.getElementById('git-branch-input')?.focus(), 100); } },
    { label: 'Plan a Feature (Feature Builder)', category: 'Ship / Git', keywords: 'feature builder multi-file', action: () => { switchTab('workspace'); setTimeout(() => document.getElementById('feature-description')?.focus(), 100); } },
    { label: 'Generate Changelog Entry', category: 'Ship / Git', keywords: 'changelog release notes', action: () => { switchTab('workspace'); generateChangelog(); } },
    { label: 'Run Pipeline (Audit → Repair → Test → Gate)', category: 'Ship / Git', keywords: 'pipeline test gate audit', action: () => { switchTab('workspace'); runPipeline(); } },
    { label: 'Run Deploy', category: 'Ship / Git', keywords: 'deploy ship release', action: () => { switchTab('workspace'); runDeploy(); } },

    { label: 'Analyze Bug (Bug Fix Assist)', category: 'AI Assist', keywords: 'fix bug error nim', action: () => { switchTab('workspace'); setTimeout(() => document.getElementById('assist-error-text')?.focus(), 100); } },
    { label: 'Analyze Active Project for Feature Suggestions', category: 'AI Assist', keywords: 'suggestions ideas advisory', action: () => { switchTab('workspace'); analyzeFeatures(); } },

    { label: 'Refresh Live Preview', category: 'Preview', keywords: 'reload webview refresh', action: () => { switchTab('workspace'); loadPreview(); } },
    { label: 'Open Preview in Browser', category: 'Preview', keywords: 'external browser', action: () => { switchTab('workspace'); openInBrowser(); } },
    { label: 'Inspect Preview (DevTools)', category: 'Preview', keywords: 'debug console devtools webview', action: () => { switchTab('workspace'); inspectPreview(); } },
    { label: 'Clear Preview Cache', category: 'Preview', keywords: 'service worker stale broken', action: () => clearPreviewCache() },

    { label: 'Save Current File (Code Editor)', category: 'Code Editor', keywords: 'save write', action: () => saveCurrentEditorFile() },
  ];
}

let cmdpFiltered = [];
let cmdpSelectedIndex = 0;

function openCommandPalette() {
  document.getElementById('cmdp-overlay').classList.add('open');
  const input = document.getElementById('cmdp-input');
  input.value = '';
  cmdpSelectedIndex = 0;
  renderCommandPaletteResults();
  setTimeout(() => input.focus(), 30);
}

function closeCommandPalette() {
  document.getElementById('cmdp-overlay').classList.remove('open');
}

function renderCommandPaletteResults() {
  const query = document.getElementById('cmdp-input').value.trim().toLowerCase();
  const all = getCommandList();
  cmdpFiltered = query
    ? all.filter((c) => (c.label + ' ' + c.category + ' ' + c.keywords).toLowerCase().includes(query))
    : all;
  cmdpSelectedIndex = 0;

  const resultsEl = document.getElementById('cmdp-results');
  if (cmdpFiltered.length === 0) {
    resultsEl.innerHTML = '<div class="cmdp-empty">No matching commands.</div>';
    return;
  }
  resultsEl.innerHTML = cmdpFiltered.map((c, i) => `
    <div class="cmdp-item ${i === cmdpSelectedIndex ? 'selected' : ''}" onclick="executeCommandPaletteItem(${i})">
      <span>${escapeHtml(c.label)}</span>
      <span class="cmdp-item-category">${escapeHtml(c.category)}</span>
    </div>
  `).join('');
}

function highlightCommandPaletteSelection() {
  document.querySelectorAll('.cmdp-item').forEach((el, i) => {
    el.classList.toggle('selected', i === cmdpSelectedIndex);
  });
  const selected = document.querySelector('.cmdp-item.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

function handleCommandPaletteKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    cmdpSelectedIndex = Math.min(cmdpSelectedIndex + 1, cmdpFiltered.length - 1);
    highlightCommandPaletteSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    cmdpSelectedIndex = Math.max(cmdpSelectedIndex - 1, 0);
    highlightCommandPaletteSelection();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    executeCommandPaletteItem(cmdpSelectedIndex);
  } else if (e.key === 'Escape') {
    closeCommandPalette();
  }
}

function executeCommandPaletteItem(index) {
  const cmd = cmdpFiltered[index];
  if (!cmd) return;
  closeCommandPalette();
  cmd.action();
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const overlay = document.getElementById('cmdp-overlay');
    if (overlay.classList.contains('open')) closeCommandPalette();
    else openCommandPalette();
  }
});

// Escape closes whichever overlay is actually open - checked in the order
// they can stack (the file picker nests inside the Code Editor, so it
// needs to close first if both happen to be open at once; Command Palette
// sits above everything else, so it's checked first of all).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('cmdp-overlay').classList.contains('open')) { closeCommandPalette(); return; }
  if (document.getElementById('ce-file-picker-overlay').style.display === 'block') { closeCeFilePicker(); return; }
  if (document.getElementById('code-editor-diff-overlay').style.display === 'flex') { rejectEditorPrompt(); return; }
  if (document.getElementById('aitools-overlay').classList.contains('open')) { closeAIToolsPanel(); return; }
  if (document.getElementById('pipeline-overlay').classList.contains('open')) { closePipelinePanel(); return; }
  if (document.getElementById('activity-overlay').classList.contains('open')) { closeActivityView(); return; }
  if (document.getElementById('recentchanges-overlay').classList.contains('open')) { closeRecentChanges(); return; }
  if (document.getElementById('pkgmgr-overlay').classList.contains('open')) { closePackageManager(); return; }
  if (document.getElementById('docker-overlay').classList.contains('open')) { closeDockerPanel(); return; }
  if (document.getElementById('api-tester-overlay').classList.contains('open')) { closeApiTester(); return; }
  if (document.getElementById('code-editor-overlay').classList.contains('open')) { closeCodeEditor(); return; }
});

function switchTab(tabId) {
  const requestedSettings = tabId === 'settings';
  if (requestedSettings) tabId = 'cloud';
  const view = document.getElementById('view-' + tabId);
  const button = document.getElementById('tab-btn-' + tabId);
  if (!view || !button) {
    showToast('error', 'Navigation unavailable', `Nexus could not open the ${tabId} section.`);
    return;
  }
  document.querySelectorAll('.view-pane').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  view.classList.add('active');
  button.classList.add('active');
  if (tabId === 'cloud') setSettingsSection(requestedSettings ? 'github' : (currentSettingsSection || 'account'));
  if (tabId === 'workspace') {
    setTimeout(() => document.getElementById('term-input').focus(), 50);
    if (!currentAssistFolder) onTargetChange();
    refreshGitStatus();
    refreshLanguageBreakdown();
    const p = projects.find((x) => x.id === activeProjectId);
    document.getElementById('deploy-command').value = p?.deployCommand || '';
  }
}

// ---------- Projects ----------
async function browseFolder() {
  const folder = await window.nexus.pickFolder();
  if (folder) {
    document.getElementById('project-path').value = folder;
    await detectAndFillProjectPort(folder);
  }
}

async function detectAndFillProjectPort(folder = document.getElementById('project-path').value.trim()) {
  const portInput = document.getElementById('project-port');
  if (!folder || !portInput || portInput.value.trim()) return null;
  const result = await window.nexus.detectProjectPort(folder);
  if (!result?.ok || !result.detectedPort?.port) return null;
  portInput.value = result.detectedPort.port;
  showToast('info', `Detected port ${result.detectedPort.port}`, `Filled from ${result.detectedPort.source}. You can change it before saving.`);
  return result.detectedPort;
}

async function detectAndSelectProjectType(folder = document.getElementById('project-path').value.trim()) {
  if (!folder) return null;
  const result = await window.nexus.detectProjectType(folder);
  const templateId = result?.detectedType?.templateId;
  if (!result?.ok || !['website', 'app', 'api'].includes(templateId)) return null;
  const radio = document.querySelector(`input[name="new-project-template"][value="${templateId}"]`);
  if (radio) radio.checked = true;
  selectProjectTemplate(templateId);
  return result.detectedType;
}

async function detectAndFillProjectMetadata(folder = document.getElementById('project-path').value.trim()) {
  if (!folder) return { detectedPort:null, detectedType:null };
  const [detectedPort, detectedType] = await Promise.all([
    detectAndFillProjectPort(folder),
    detectAndSelectProjectType(folder),
  ]);
  return { detectedPort, detectedType };
}

window.nexus.onProjectCloneLog(({ line }) => {
  const el = document.getElementById('clone-progress');
  if (el) el.innerText = line;
});

function persistProjects() {
  localStorage.setItem('nexus_projects', JSON.stringify(projects));
  localStorage.setItem('nexus_active', JSON.stringify(activeProjectId));
  localStorage.setItem('nexus_projects_schema_version', String(PROJECTS_SCHEMA_VERSION));
  window.nexus.setProjectsForExitSync(projects);
}

let githubRepositoryChoices = [];

async function showGitHubRepositoryPicker() {
  const picker = document.getElementById('github-repository-picker');
  picker.style.display = 'block';
  picker.innerHTML = '<p class="muted small">Loading repositories available to your GitHub account…</p>';
  const result = await window.nexus.githubListRepos();
  if (!result.ok) {
    picker.innerHTML = `<p class="muted small">${escapeHtml(result.error)}</p><button class="btn" onclick="switchTab('settings')">Connect GitHub</button>`;
    return;
  }
  githubRepositoryChoices = result.repos;
  picker.innerHTML = result.repos.map((repo, index) => `<button class="suggestion-item" style="display:block; width:100%; text-align:left;" onclick="selectGitHubRepository(${index})"><strong>${escapeHtml(repo.fullName)}</strong> ${repo.private ? '<span class="badge">Private</span>' : '<span class="muted small">Public</span>'}<span class="muted small" style="display:block;">${escapeHtml(repo.description || 'No description')}</span></button>`).join('') || '<p class="muted small">No repositories are available to this GitHub connection.</p>';
}

function selectGitHubRepository(index) {
  const repo = githubRepositoryChoices[index];
  if (!repo) return;
  document.getElementById('project-path').value = repo.htmlUrl;
  const nameInput = document.getElementById('project-name');
  if (!nameInput.value.trim()) nameInput.value = repo.name;
  document.getElementById('github-repository-picker').style.display = 'none';
  document.getElementById('clone-progress').innerText = repo.private ? 'Private repository selected. Nexus will use your encrypted GitHub connection when cloning.' : 'GitHub repository selected.';
}

let editingProjectId = null;

const projectTemplatePlaceholders = {
  website: 'Describe the website you want to create',
  app: 'Describe the app, its users, and what they should be able to do',
  api: 'Describe the data and operations the API should provide',
};

function selectProjectTemplate(templateId) {
  document.getElementById('new-project-description').placeholder = projectTemplatePlaceholders[templateId] || projectTemplatePlaceholders.website;
}

async function generateNewProjectUI(e) {
  const name = document.getElementById('new-project-name').value.trim();
  const description = document.getElementById('new-project-description').value.trim();
  const templateId = document.querySelector('input[name="new-project-template"]:checked')?.value;
  const progressEl = document.getElementById('new-project-progress');

  if (!name || !description) {
    alert('Give the new project a name and describe what it should do.');
    return;
  }

  const btn = e.target;
  btn.disabled = true;
  progressEl.innerText = 'Asking your selected coding model to generate the starter project… this can take up to a minute for a real, complete file set.';

  const result = await window.nexus.generateNewProject(name, description, templateId);

  btn.disabled = false;

  if (!result.ok) {
    progressEl.innerText = '';
    if (result.raw) {
      console.error('Raw AI response that failed to parse:', result.raw);
      alert('Generation failed: ' + result.error + '\n\n(The raw AI response was logged to the console for debugging.)');
    } else {
      alert('Generation failed: ' + result.error);
    }
    return;
  }

  progressEl.innerText = '';
  document.getElementById('new-project-name').value = '';
  document.getElementById('new-project-description').value = '';

  const newProject = {
    id: Date.now(),
    name,
    folder: result.path,
    command: result.suggestedCommand,
    port: result.suggestedPort || '',
    templateId: result.templateId,
    running: false,
  };
  projects.push(newProject);
  await classifyGameProject(newProject, { showGuide: true });
  activeProjectId = newProject.id;
  persistProjects();
  renderProjects();

  showToast('success', `Generated ${result.files.length} file(s)`, `${result.path}\n\nOpening in the Code Editor for review.`);
  await toggleCodeEditor();
}

async function addProject(e) {
  let name = document.getElementById('project-name').value.trim();
  const rawInput = document.getElementById('project-path').value.trim();
  const command = document.getElementById('project-command').value.trim() || 'npm run dev';
  const portInput = document.getElementById('project-port');
  let port = portInput.value.trim();
  const mayReplaceDefaultPort = port === '';
  const progressEl = document.getElementById('clone-progress');

  if (port && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
    alert('Enter a port from 1 through 65535, or leave it blank for automatic detection.');
    return;
  }

  if (!rawInput) {
    alert('Pick a project folder, choose a GitHub repository, or paste its GitHub URL. Nexus will fill in the project name automatically.');
    return;
  }

  const saveBtn = e.target;
  saveBtn.disabled = true;

  // Editing an existing project: the folder is already real and settled,
  // so skip the clone/resolve step entirely - just update the fields.
  if (editingProjectId !== null) {
    const p = projects.find((x) => x.id === editingProjectId);
    if (p) {
      const wasRunning = p.running;
      if (wasRunning) {
        alert('Stop this project before editing it, then try again.');
        saveBtn.disabled = false;
        return;
      }
      p.name = name;
      p.command = command;
      p.port = port;
      // Folder is intentionally left alone here - re-resolving it would
      // re-trigger a clone attempt on a GitHub URL that's already been
      // turned into a real local path. Use Browse in the form if the
      // folder itself genuinely needs to change.
      if (rawInput !== p.folder) p.folder = rawInput;
      p.gameDetectionVersion = 0;
      await classifyGameProject(p, { showGuide: true });
    }
    editingProjectId = null;
    saveBtn.innerText = 'Save Project';
    saveBtn.disabled = false;
    document.getElementById('project-name').value = '';
    document.getElementById('project-path').value = '';
    document.getElementById('project-command').value = 'npm run dev';
    document.getElementById('project-port').value = '';
    persistProjects();
    renderProjects();
    return;
  }

  progressEl.innerText = 'Checking path...';

  const result = await window.nexus.resolveProjectPath(rawInput);

  saveBtn.disabled = false;

  if (!result.ok) {
    progressEl.innerText = '';
    alert('Could not use that path: ' + result.error);
    return;
  }

  progressEl.innerText = '';
  const folder = result.path;
  name = name || result.suggestedName;
  if (!name) {
    alert('Nexus could not determine a project name. Enter a display name and try again.');
    return;
  }
  if (result.readiness && !result.readiness.ready) {
    const tasks = [result.readiness.needsInstall && 'install locked dependencies', result.readiness.needsBuild && 'generate missing build output'].filter(Boolean);
    progressEl.innerText = `Download checked. On first launch Nexus will ${tasks.join(' and ')} after Workspace Trust approval.`;
    showToast('info', 'Downloaded project checked', progressEl.innerText);
  }

  if (result.detectedPort?.port && mayReplaceDefaultPort) {
    port = result.detectedPort.port;
    portInput.value = port;
    showToast('info', `Detected port ${port}`, `Found from ${result.detectedPort.source}.`);
  }
  port ||= '3000';

  const detectedTypeResult = await window.nexus.detectProjectType(folder);
  const templateId = detectedTypeResult?.ok && ['website', 'app', 'api'].includes(detectedTypeResult.detectedType?.templateId)
    ? detectedTypeResult.detectedType.templateId
    : undefined;
  if (templateId) {
    const radio = document.querySelector(`input[name="new-project-template"][value="${templateId}"]`);
    if (radio) radio.checked = true;
    selectProjectTemplate(templateId);
  }

  const project = { id: Date.now(), name, folder, command, port, templateId, running: false };
  projects.push(project);
  await classifyGameProject(project, { showGuide: true });
  document.getElementById('project-name').value = '';
  document.getElementById('project-path').value = '';
  document.getElementById('project-port').value = '';
  persistProjects();
  renderProjects();
}

function editProject(id, e) {
  e.stopPropagation();
  const p = projects.find((x) => x.id === id);
  if (!p) return;
  if (p.running) {
    alert('Stop this project before editing it.');
    return;
  }
  editingProjectId = id;
  document.getElementById('project-name').value = p.name;
  document.getElementById('project-path').value = p.folder;
  document.getElementById('project-command').value = p.command;
  document.getElementById('project-port').value = p.port;
  document.querySelector('#view-projects .card button.btn[onclick^="addProject"]').innerText = 'Update Project';
  document.getElementById('project-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEdit() {
  editingProjectId = null;
  document.getElementById('project-name').value = '';
  document.getElementById('project-path').value = '';
  document.getElementById('project-command').value = 'npm run dev';
  document.getElementById('project-port').value = '';
  document.querySelector('#view-projects .card button.btn[onclick^="addProject"]').innerText = 'Save Project';
}

function removeProject(id, e) {
  e.stopPropagation();
  const p = projects.find((x) => x.id === id);
  if (p && p.running) window.nexus.stopProject(id);
  projects = projects.filter((x) => x.id !== id);
  if (activeProjectId === id) activeProjectId = null;
  if (openConfigProjectId === id) openConfigProjectId = null;
  persistProjects();
  renderProjects();
}

function setPreviewVisible(visible) {
  document.getElementById('preview-placeholder').style.display = visible ? 'none' : 'flex';
  document.getElementById('preview-live').style.display = visible ? 'flex' : 'none';
}

async function toggleProject(id, e) {
  e.stopPropagation();
  const p = projects.find((x) => x.id === id);
  if (!p) return;

  if (p.running) {
    await window.nexus.stopProject(id);
    p.running = false;
    if (activeProjectId === id) setPreviewVisible(false);
  } else {
    const result = await window.nexus.launchProject(id, p.folder, p.command, p.port, p.projectUid, p.sandboxed);
    if (!result.ok) {
      alert('Could not launch: ' + result.error);
      return;
    }
    p.running = true;
    activeProjectId = id;
    document.getElementById('preview-url').value = `http://localhost:${p.port}`;
    document.getElementById('log-project-name').innerText = p.name;
    document.getElementById('log-screen').innerText = '';
    setPreviewVisible(true);
    switchTab('workspace');
    if (result.prepared?.length) {
      showToast('success', 'Project prepared automatically', result.prepared.includes('build')
        ? 'Nexus installed the locked dependencies and generated the missing build output before launch.'
        : 'Nexus installed the project dependencies before launch.');
    }
    // Give the dev server a moment to boot before we point the webview at it
    // (sandboxed launches pull the node:20 image on first run, which can
    // take a bit longer than a direct host launch).
    setTimeout(loadPreview, p.sandboxed ? 4000 : 1500);
  }
  persistProjects();
  renderProjects();
}

function toggleSandboxed(id, e) {
  e.stopPropagation();
  const p = projects.find((x) => x.id === id);
  if (!p) return;
  if (p.running) { alert('Stop the project first to change its sandbox setting.'); renderProjects(); return; }
  p.sandboxed = !p.sandboxed;
  persistProjects();
  renderProjects();
}

let currentSettingsSection = 'account';
function settingsSectionForCard(card) {
  if (card.querySelector('#nexus-profile-title, #connected-services-title, #account-vault-passphrase, #email-account-email')) return 'account';
  if (card.querySelector('#github-settings-title, #github-operations-summary, #github-project-pr-list, #config-active-name, #secret-key-name') || /GitHub|Stashes & Conflicts|Portable Project Setup|Project Constitution|Services —|Detected Integrations/.test(card.textContent)) return 'github';
  return 'system';
}

function setSettingsSection(section) {
  const allowed = new Set(['account', 'github', 'system']);
  currentSettingsSection = allowed.has(section) ? section : 'account';
  const view = document.getElementById('view-cloud');
  if (!view) return;
  view.querySelectorAll(':scope > .card').forEach((card) => { card.hidden = settingsSectionForCard(card) !== currentSettingsSection; });
  view.querySelectorAll('.settings-section-nav [data-settings-section]').forEach((button) => button.classList.toggle('active', button.dataset.settingsSection === currentSettingsSection));
  view.scrollTop = 0;
}

async function linkProjectToAccount(id, event) {
  event.stopPropagation();
  const project = projects.find((item) => item.id === id);
  if (!project) return;
  const account = await window.nexus.accountVaultStatus();
  if (!account.email) { showToast('error', 'Sign in to your Nexus account first', 'Account-linked projects belong to the signed-in Nexus profile.'); return; }
  const reference = await window.nexus.projectAccountReference(project.folder);
  if (!reference.ok) { showToast('error', 'Project cannot be linked yet', reference.error); return; }
  project.accountLinked = true;
  project.accountProjectId ||= (globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  project.accountRepositoryUrl = reference.repositoryUrl;
  project.accountSourceProvider = reference.provider;
  project.accountLinkedAt = new Date().toISOString();
  persistProjects(); renderProjects();
  showToast('success', 'Project linked to account', 'Its safe metadata and GitHub reference will be included in the encrypted vault. Source files and secrets remain separate.');
}

function unlinkProjectFromAccount(id, event) {
  event.stopPropagation();
  const project = projects.find((item) => item.id === id);
  if (!project || !confirm(`Unlink ${project.name} from your Nexus account? The local project and GitHub repository will not be deleted.`)) return;
  project.accountLinked = false;
  delete project.accountRepositoryUrl; delete project.accountSourceProvider; delete project.accountLinkedAt;
  persistProjects(); renderProjects();
  showToast('info', 'Project unlinked from account', 'Use Sync now to remove it from the encrypted account project list.');
}

// Moves the single shared config panel into whichever project card's slot
// is currently open, or hides it if none is open. Called both when a card's
// Config button is clicked, and again automatically at the end of every
// renderProjects() rebuild - since rebuilding the card list destroys and
// recreates all card DOM nodes (including whatever slot was holding the
// panel), this re-homes it into the freshly-rebuilt matching slot so an
// open config panel survives things like starting/stopping a project.
function attachConfigPanel() {
  const panel = document.getElementById('project-config-panel');
  if (!panel) return;
  if (openConfigProjectId === null) {
    panel.style.display = 'none';
    return;
  }
  const slot = document.getElementById(`project-config-slot-${openConfigProjectId}`);
  if (!slot) {
    // The project this panel belonged to no longer exists (e.g. removed).
    openConfigProjectId = null;
    panel.style.display = 'none';
    return;
  }
  slot.appendChild(panel);
  panel.style.display = 'flex';
}

async function toggleProjectConfig(id, e) {
  e.stopPropagation();
  if (openConfigProjectId === id) {
    openConfigProjectId = null;
    renderProjects();
    return;
  }
  openConfigProjectId = id;
  activeProjectId = id;
  persistProjects();
  renderProjects();
  await renderConfigTab();
}

function renderProjects() {
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  if (projects.length === 0) {
    list.innerHTML = '<p class="muted small" style="grid-column: 1/-1;">No projects yet. Browse to a real project folder above and save it.</p>';
    document.getElementById('header-active-name').innerText = 'None';
    return;
  }
  projects.forEach((p) => {
    const isConfigOpen = openConfigProjectId === p.id;
    const card = document.createElement('div');
    card.className = 'project-card' + (p.running ? ' running' : '') + (isConfigOpen ? ' config-open' : '');
    if (isConfigOpen) card.style.gridColumn = '1 / -1';
    card.innerHTML = `
      <div>
        <div class="row" style="justify-content:space-between; align-items:center;">
          <strong>${escapeHtml(p.name)}</strong>
          <div>
            <button onclick="editProject(${p.id}, event)" style="background:none; border:none; color:var(--text-muted); cursor:pointer; margin-right:4px;" title="Edit">✎</button>
            <button onclick="removeProject(${p.id}, event)" style="background:none; border:none; color:var(--danger); cursor:pointer;">✕</button>
          </div>
        </div>
        <p class="path">${escapeHtml(p.folder)}</p>
        <p class="meta">${escapeHtml(p.command)} — port ${escapeHtml(p.port)}</p>
        ${p.gameDevelopment?.isGame ? `<div class="row" style="margin-top:6px; align-items:center;"><span class="pill on">GAME · ${escapeHtml(p.gameDevelopment.engine)}</span><button class="btn tiny btn-secondary" onclick="showGameDevelopmentGuide(${p.id}, event)">Where to develop it</button></div>` : ''}
        <div class="row" style="margin-top:6px; align-items:center;">
          <span class="pill" id="project-trust-${p.id}">RESTRICTED</span>
          <button class="btn tiny btn-secondary" onclick="configureWorkspaceTrust(${p.id}, event)">Review permissions</button>
          <button class="btn tiny btn-secondary" onclick="revokeWorkspaceTrust(${p.id}, event)">Revoke</button>
        </div>
        <div class="row" style="margin-top:6px; align-items:center;">
          <span class="pill ${p.accountLinked ? 'on' : ''}">${p.accountLinked ? 'ACCOUNT LINKED' : 'THIS COMPUTER'}</span>
          ${p.accountLinked ? `<button class="btn tiny btn-secondary" onclick="unlinkProjectFromAccount(${p.id}, event)">Unlink account</button>` : `<button class="btn tiny btn-secondary" onclick="linkProjectToAccount(${p.id}, event)">Link to account</button>`}
        </div>
        <label class="muted small" style="display:flex; align-items:center; gap:6px; margin-top:4px; cursor:pointer;" title="Run inside a Docker container that can only see this project's own folder - it can't read or write anything else on this machine, including Nexus itself.">
          <input type="checkbox" ${p.sandboxed ? 'checked' : ''} ${p.running ? 'disabled' : ''} onclick="toggleSandboxed(${p.id}, event)">
          🛡️ Sandboxed (Docker)
        </label>
      </div>
      <div class="row">
        <button class="btn ${p.running ? 'btn-secondary' : ''}" style="flex:1;" onclick="toggleProject(${p.id}, event)">
          ${p.running ? '■ Stop' : '▶ Launch'}
        </button>
        <button class="btn btn-secondary" onclick="toggleProjectConfig(${p.id}, event)">
          ⚙️ ${isConfigOpen ? 'Hide Config' : 'Config'}
        </button>
        <span class="pill ${p.running ? 'on' : ''}">${p.running ? 'RUNNING' : 'STOPPED'}</span>
        ${p.sandboxed ? '<span class="pill" style="background:var(--emerald); color:#0d1117;" title="Sandboxed">🛡️</span>' : ''}
      </div>
      <div class="project-config-slot" id="project-config-slot-${p.id}"></div>
    `;
    list.appendChild(card);
  });
  attachConfigPanel();
  refreshWorkspaceTrustBadges();
  const active = projects.find((p) => p.id === activeProjectId);
  document.getElementById('header-active-name').innerText = active ? active.name : 'None';
  backfillGameProjectClassifications();
}

let activeGameGuideProjectId = null;
let gameClassificationBackfillRunning = false;
async function classifyGameProject(project, { showGuide = false } = {}) {
  if (!project?.folder) return null;
  const result = await window.nexus.detectGameProject(project.folder);
  project.gameDetectionVersion = 1;
  project.gameDevelopment = result?.isGame ? result : null;
  if (result?.isGame && showGuide) displayGameDevelopmentGuide(project);
  return result;
}
async function backfillGameProjectClassifications() {
  if (gameClassificationBackfillRunning) return;
  const pending = projects.filter((project) => project.gameDetectionVersion !== 1);
  if (!pending.length) return;
  gameClassificationBackfillRunning = true;
  let foundGame = null;
  for (const project of pending) { const result = await classifyGameProject(project); if (!foundGame && result?.isGame) foundGame = project; }
  gameClassificationBackfillRunning = false;
  persistProjects();
  renderProjects();
  if (foundGame) displayGameDevelopmentGuide(foundGame);
}
function displayGameDevelopmentGuide(project) {
  const guide = project?.gameDevelopment;
  if (!guide?.isGame) return;
  activeGameGuideProjectId = project.id;
  document.getElementById('game-guide-title').innerText = `${project.name} is a ${guide.engine} project`;
  document.getElementById('game-guide-reason').innerText = `For proper development, use ${guide.tool}. ${guide.reason}`;
  document.getElementById('game-guide-evidence').innerText = `Why Nexus identified it as a game: ${guide.evidence.join(', ')}.`;
  document.getElementById('game-guide-tool-button').innerText = `Open ${guide.tool}`;
  const card = document.getElementById('game-development-guide');
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function showGameDevelopmentGuide(id, event) { event?.stopPropagation(); const project = projects.find((item) => item.id === id); if (project) displayGameDevelopmentGuide(project); }
function hideGameDevelopmentGuide() { document.getElementById('game-development-guide').style.display = 'none'; }
function openGameDevelopmentLink(kind) { const project = projects.find((item) => item.id === activeGameGuideProjectId); const guide = project?.gameDevelopment; const url = kind === 'docs' ? guide?.docsUrl : guide?.url; if (url) window.nexus.openExternal(url); }

function escapeHtml(str) {
  const d = document.createElement('div');
  d.innerText = str;
  return d.innerHTML;
}

// ---------- Code Editor ----------
// Real file tree + syntax-highlighted editing over the active project,
// using CodeMirror. Every save goes through the exact same
// window.nexus.applyFileChange() used by Bug Fix Assist approvals - same
// automatic .bak backup, no separate/weaker write path for manual edits.
let codeEditorCM = null;
let codeEditorOpenFiles = []; // [{ relPath, absPath, content, dirty }]
let codeEditorCurrentRelPath = null;
let codeEditorExpandedFolders = new Set();
let codeEditorFolder = null;
let languageDiagnosticsTimer = null;
let codeLibraryEntries = [];
let selectedCodeLibraryEntry = null;

function editorAbsPath(folder, relPath) {
  return folder.replace(/[\\/]+$/, '') + '/' + relPath.replace(/\\/g, '/');
}

function codeEditorModeFor(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    js: { name: 'javascript' }, jsx: { name: 'javascript', jsx: true },
    ts: { name: 'javascript', typescript: true }, tsx: { name: 'javascript', typescript: true, jsx: true },
    json: { name: 'javascript', json: true },
    html: 'htmlmixed', htm: 'htmlmixed',
    css: 'css', scss: 'css', less: 'css',
    md: 'markdown', markdown: 'markdown',
    py: 'python',
    java: 'text/x-java', c: 'text/x-csrc', cpp: 'text/x-c++src', cs: 'text/x-csharp',
    sh: 'shell', bash: 'shell',
    yml: 'yaml', yaml: 'yaml',
    xml: 'xml',
  };
  return map[ext] || null; // null = plain text, no highlighting
}

// ---------- API Tester ----------
// Real HTTP requests, sent from the main process (no renderer CORS
// restriction), with a real per-project saved-request collection persisted
// to .nexus-api-requests.json - not an in-memory list that vanishes on
// restart.
let apiCurrentFolder = null;
let apiSavedRequests = [];

// ---------- Docker ----------
// Real docker CLI calls - build, run, stop, remove, list, stream logs.
// Every action shells out to the user's own installed docker binary.
let dockerBuildInProgress = null; // the image tag currently building, or null

window.nexus.onDockerBuildLog(({ text }) => {
  const el = document.getElementById('docker-build-log');
  el.style.display = 'block';
  el.innerText += text;
  el.scrollTop = el.scrollHeight;
});

window.nexus.onDockerBuildDone(({ ok, code }) => {
  const el = document.getElementById('docker-build-log');
  el.innerText += ok ? '\n✓ Build succeeded.\n' : `\n✕ Build failed (exit code ${code}).\n`;
  el.scrollTop = el.scrollHeight;
  document.getElementById('docker-build-tag').disabled = false;
  dockerBuildInProgress = null;
});

window.nexus.onDockerContainerLog(({ containerName, text }) => {
  if (document.getElementById('docker-logs-container-name').innerText !== containerName) return;
  const el = document.getElementById('docker-container-logs');
  el.innerText += text;
  el.scrollTop = el.scrollHeight;
});

// ---------- Package Manager ----------
// Real npm install/uninstall/update against the active project's own
// package.json and node_modules. Installed-version data is read directly
// from node_modules, not just trusted from package.json's semver range.
let pkgmgrOutdated = {};
let pkgmgrOpCounter = 0;

window.nexus.onNpmOpLog(({ opId, text }) => {
  if (opId !== pkgmgrActiveOpId) return;
  const el = document.getElementById('pkgmgr-log');
  el.innerText += text;
  el.scrollTop = el.scrollHeight;
});

window.nexus.onNpmOpDone(({ opId, ok, code }) => {
  if (opId !== pkgmgrActiveOpId) return;
  const el = document.getElementById('pkgmgr-log');
  el.innerText += ok ? '\n✓ Done.\n' : `\n✕ Failed (exit code ${code}).\n`;
  el.scrollTop = el.scrollHeight;
  pkgmgrActiveOpId = null;
  pkgmgrActiveLabel = null;
  refreshPackageList();
});

let pkgmgrActiveOpId = null;

// ---------- Recent Changes ----------
// Every write that creates a real .bak file (AI approvals across all four
// features, manual Code Editor saves, Search & Replace, Format/Lint) is
// recorded centrally. Revert restores the .bak over the current file -
// same real backup mechanism that already existed, just made visible and
// actionable in one place instead of requiring you to know a .bak exists
// and find it manually.
// ---------- Activity ----------
// Aggregates state that's ALREADY tracked correctly elsewhere in the app -
// this is not a second, parallel tracking system that could drift out of
// sync with reality. Running projects come from the same `projects` array
// every other panel uses; Docker containers come from a live `docker ps`
// call, not a cache; npm/Docker-build state comes from the same variables
// their own panels already maintain.
// ---------- Object Pipeline ----------
// PowerShell-inspired structured queries over Nexus's own real data. The
// interpreter itself (pipelineEngine.js) contains no eval/Function/vm.Script
// anywhere - see its own header comment for why that's a stronger safety
// property than any JS "sandbox." This function's only job is to gather
// real context data from Nexus's existing, already-reviewed data sources
// before handing it to the interpreter - never fabricated, never fetched
// by the interpreter itself.
async function togglePipelinePanel() {
  const overlay = document.getElementById('pipeline-overlay');
  const isOpen = overlay.classList.contains('open');
  if (isOpen) { closePipelinePanel(); return; }
  dockTray('pipeline-overlay');
  setTimeout(() => document.getElementById('pipeline-input').focus(), 30);
}

function closePipelinePanel() {
  document.getElementById('pipeline-overlay').classList.remove('open');
}

async function gatherPipelineContext() {
  const context = { projects, dockerContainers: [], gitStatusFiles: [], recentChanges: [], guardrailResults: [], aiMetrics: [] };

  const dockerCheck = await window.nexus.dockerCheck();
  if (dockerCheck.installed && dockerCheck.running) {
    const psResult = await window.nexus.dockerPs();
    if (psResult.ok) context.dockerContainers = psResult.containers;
  }

  const folder = activeProjectFolder();
  if (folder) {
    const diffResult = await window.nexus.gitDiff(folder);
    if (diffResult.ok) context.gitStatusFiles = diffResult.files.map((f) => ({ relPath: f.relPath, status: f.status }));

    // Real, already-persisted AI Improvement Framework history for the
    // active project - this only reads what's already on disk (past
    // guardrail runs, past recorded AI calls), it does not trigger a new
    // guardrail run or AI call just by opening the Pipeline panel.
    // aiFwGuardrailHistory/aiFwMetricsHistory both resolve to a plain array
    // (see aiGuardrailTester.getGuardrailHistory / aiMetrics.getMetricsHistory).
    const guardrailHistory = await window.nexus.aiFwGuardrailHistory(folder, 50);
    if (Array.isArray(guardrailHistory)) context.guardrailResults = guardrailHistory;

    const metricsHistory = await window.nexus.aiFwMetricsHistory(folder, 200);
    if (Array.isArray(metricsHistory)) context.aiMetrics = metricsHistory;
  }

  const changesResult = await window.nexus.getRecentChanges();
  if (changesResult.ok) context.recentChanges = changesResult.changes;

  return context;
}

async function runPipelineQueryUI() {
  const input = document.getElementById('pipeline-input').value.trim();
  const errorEl = document.getElementById('pipeline-error');
  const outputEl = document.getElementById('pipeline-output');
  if (!input) return;

  errorEl.style.display = 'none';
  outputEl.innerHTML = '<p class="muted small">Running…</p>';

  const context = await gatherPipelineContext();
  const result = await window.nexus.runPipelineQuery(input, context);

  if (!result.ok) {
    outputEl.innerHTML = '';
    errorEl.style.display = 'block';
    errorEl.innerText = result.error;
    return;
  }

  renderPipelineOutput(result.data);
}

function renderPipelineOutput(data) {
  const outputEl = document.getElementById('pipeline-output');
  if (!Array.isArray(data) || data.length === 0) {
    outputEl.innerHTML = '<p class="muted small">No results.</p>';
    return;
  }

  const columns = [...new Set(data.flatMap((row) => Object.keys(row || {})))];
  const rowsHtml = data.map((row) => `
    <tr>${columns.map((c) => `<td>${escapeHtml(String(row?.[c] ?? ''))}</td>`).join('')}</tr>
  `).join('');

  outputEl.innerHTML = `
    <table class="pl-table">
      <thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <p class="muted small" style="margin-top:6px;">${data.length} row(s)</p>
  `;
}

async function toggleActivityView() {
  const overlay = document.getElementById('activity-overlay');
  const isOpen = overlay.classList.contains('open');
  if (isOpen) { closeActivityView(); return; }
  dockTray('activity-overlay');
  await refreshActivityView();
}

function closeActivityView() {
  document.getElementById('activity-overlay').classList.remove('open');
}

async function refreshActivityView() {
  const runningProjects = projects.filter((p) => p.running);
  const projectsEl = document.getElementById('activity-projects-list');
  projectsEl.innerHTML = runningProjects.length === 0
    ? '<p class="muted small">Nothing running.</p>'
    : runningProjects.map((p) => `
        <div class="act-row">
          <span class="act-dot"></span>
          <span class="act-name">${escapeHtml(p.name)}</span>
          <span class="act-meta">port ${escapeHtml(p.port)}</span>
          <button class="btn tiny btn-secondary" onclick="toggleProject(${p.id}, event)">Stop</button>
        </div>
      `).join('');

  const dockerEl = document.getElementById('activity-docker-list');
  const dockerCheck = await window.nexus.dockerCheck();
  if (!dockerCheck.installed || !dockerCheck.running) {
    dockerEl.innerHTML = `<p class="muted small">${!dockerCheck.installed ? 'Docker not installed.' : 'Docker daemon not running.'}</p>`;
  } else {
    const psResult = await window.nexus.dockerPs();
    const runningContainers = psResult.ok ? psResult.containers.filter((c) => c.status.toLowerCase().startsWith('up')) : [];
    let dockerHtml = '';
    if (dockerBuildInProgress) {
      dockerHtml += `<div class="act-row"><span class="act-dot"></span><span class="act-name">Building ${escapeHtml(dockerBuildInProgress)}…</span></div>`;
    }
    if (runningContainers.length > 0) {
      dockerHtml += runningContainers.map((c) => `
        <div class="act-row">
          <span class="act-dot"></span>
          <span class="act-name">${escapeHtml(c.names)}</span>
          <span class="act-meta">${escapeHtml(c.image)}</span>
          <button class="btn tiny btn-secondary" onclick="stopDockerContainer('${escapeHtml(c.names)}')">Stop</button>
        </div>
      `).join('');
    }
    dockerEl.innerHTML = dockerHtml || '<p class="muted small">No containers running.</p>';
  }

  const npmEl = document.getElementById('activity-npm-list');
  npmEl.innerHTML = pkgmgrActiveOpId
    ? `<div class="act-row"><span class="act-dot"></span><span class="act-name">${escapeHtml(pkgmgrActiveLabel || 'Running…')}</span></div>`
    : '<p class="muted small">Nothing in progress.</p>';
}

// Cheap, synchronous-state-only check (no async docker ps call) - keeps
// this safe to run frequently without adding overhead. The dot means "at
// least one thing worth checking on"; the full panel has the real detail.
function updateActivityDot() {
  const anythingActive = projects.some((p) => p.running) || pkgmgrActiveOpId !== null || dockerBuildInProgress !== null;
  document.getElementById('activity-dot').style.display = anythingActive ? 'block' : 'none';
}
setInterval(updateActivityDot, 3000);

async function toggleRecentChanges() {
  const overlay = document.getElementById('recentchanges-overlay');
  const isOpen = overlay.classList.contains('open');
  if (isOpen) { closeRecentChanges(); return; }
  dockTray('recentchanges-overlay');
  await refreshRecentChanges();
}

function closeRecentChanges() {
  document.getElementById('recentchanges-overlay').classList.remove('open');
}

function formatRelativeTime(timestamp) {
  const diffMs = Date.now() - timestamp;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

async function refreshRecentChanges() {
  const listEl = document.getElementById('recentchanges-list');
  const result = await window.nexus.getRecentChanges();
  if (!result.ok) { listEl.innerHTML = '<p class="muted small">Could not load the change log.</p>'; return; }

  if (result.changes.length === 0) {
    listEl.innerHTML = '<p class="muted small">No changes recorded yet this session or before.</p>';
    return;
  }

  listEl.innerHTML = result.changes.map((c, i) => `
    <div class="rc-row" id="rc-row-${i}">
      <div class="rc-row-top">
        <span class="rc-file" title="${escapeHtml(c.filePath)}">${escapeHtml(c.filePath.split(/[\\/]/).pop())}</span>
        <span class="rc-time">${formatRelativeTime(c.timestamp)}</span>
        <button class="btn tiny btn-secondary" onclick="revertRecentChange(${i}, '${escapeHtml(c.filePath)}', '${escapeHtml(c.backupPath)}')">↺ Revert</button>
      </div>
      <div class="rc-source">${escapeHtml(c.source)} — <span class="mono" style="font-size:10px;">${escapeHtml(c.filePath)}</span></div>
    </div>
  `).join('');
}

async function revertRecentChange(index, filePath, backupPath) {
  if (!confirm(`Revert "${filePath}" to the version before this change?\n\nThe current content will itself be backed up first, so this can be undone too.`)) return;

  const result = await window.nexus.revertChange(filePath, backupPath);
  const row = document.getElementById(`rc-row-${index}`);
  if (!result.ok) {
    alert('Revert failed: ' + result.error);
    return;
  }
  if (row) {
    row.querySelector('.rc-row-top button').outerHTML = '<span class="rc-reverted">✓ Reverted</span>';
  }

  // If the reverted file happens to be open in the Code Editor, refresh it
  // in place so the editor doesn't show stale content after a revert.
  const relPath = codeEditorOpenFiles.find((f) => f.absPath === filePath)?.relPath;
  if (relPath) {
    const fresh = await window.nexus.readFile(filePath);
    if (fresh.ok) {
      const entry = codeEditorOpenFiles.find((f) => f.relPath === relPath);
      entry.content = fresh.content;
      entry.dirty = false;
      if (codeEditorCurrentRelPath === relPath) {
        codeEditorCM.setValue(fresh.content);
        codeEditorCM.clearHistory();
      }
      renderCodeEditorTabs();
    }
  }
}

async function togglePackageManager() {
  const overlay = document.getElementById('pkgmgr-overlay');
  const isOpen = overlay.classList.contains('open');
  if (isOpen) { closePackageManager(); return; }

  const folder = activeProjectFolder();
  const p = projects.find((x) => x.id === activeProjectId);
  document.getElementById('pkgmgr-project-name').innerText = p ? p.name : 'No active project';

  if (!folder) {
    alert('No active project. Launch or select one from the Projects tab first.');
    return;
  }

  dockTray('pkgmgr-overlay');
  pkgmgrOutdated = {};
  await refreshPackageList();
}

function closePackageManager() {
  document.getElementById('pkgmgr-overlay').classList.remove('open');
}

async function refreshPackageList() {
  const folder = activeProjectFolder();
  const listEl = document.getElementById('pkgmgr-list');
  if (!folder) { listEl.innerHTML = ''; return; }

  const result = await window.nexus.npmListDeps(folder);
  if (!result.ok) { listEl.innerHTML = `<p class="muted small">${escapeHtml(result.error)}</p>`; return; }

  if (result.deps.length === 0) { listEl.innerHTML = '<p class="muted small">No dependencies.</p>'; return; }

  listEl.innerHTML = result.deps.map((d) => {
    const outdatedInfo = pkgmgrOutdated[d.name];
    const versionText = d.installedVersion
      ? `${d.installedVersion}${outdatedInfo ? ` → ${outdatedInfo.latest}` : ''}`
      : '';
    return `
      <div class="pm-row">
        <span class="pm-name" title="${escapeHtml(d.wantedVersion)}">${escapeHtml(d.name)}</span>
        ${d.dev ? '<span class="pm-dev-badge">dev</span>' : ''}
        ${d.installedVersion
          ? `<span class="pm-version ${outdatedInfo ? 'outdated' : ''}">${escapeHtml(versionText)}</span>`
          : '<span class="pm-missing">not installed</span>'}
        ${outdatedInfo ? `<button class="btn tiny btn-secondary" onclick="updatePackage('${escapeHtml(d.name)}')">↻ Update</button>` : ''}
        <button class="btn tiny btn-secondary" onclick="uninstallPackage('${escapeHtml(d.name)}')">Remove</button>
      </div>
    `;
  }).join('');
}

async function checkOutdatedPackages() {
  const folder = activeProjectFolder();
  if (!folder) return;
  const listEl = document.getElementById('pkgmgr-list');
  listEl.insertAdjacentHTML('afterbegin', '<p class="muted small" id="pkgmgr-checking">Checking for updates…</p>');

  const result = await window.nexus.npmCheckOutdated(folder);
  document.getElementById('pkgmgr-checking')?.remove();

  if (!result.ok) { alert('Could not check for updates: ' + result.error); return; }
  pkgmgrOutdated = result.outdated;
  await refreshPackageList();
}

let pkgmgrActiveLabel = null;

function startPkgmgrOp(label) {
  pkgmgrActiveOpId = `pm-${Date.now()}-${pkgmgrOpCounter++}`;
  pkgmgrActiveLabel = label;
  document.getElementById('pkgmgr-log-card').style.display = 'block';
  document.getElementById('pkgmgr-log').innerText = label + '\n';
  return pkgmgrActiveOpId;
}

async function installNewPackage() {
  const folder = activeProjectFolder();
  if (!folder) { alert('No active project.'); return; }
  const name = document.getElementById('pkgmgr-add-name').value.trim();
  const version = document.getElementById('pkgmgr-add-version').value.trim();
  const isDev = document.getElementById('pkgmgr-add-dev').checked;
  if (!name) { alert('Enter a package name.'); return; }

  const opId = startPkgmgrOp(`Installing ${name}${version ? '@' + version : ''}…`);
  const result = await window.nexus.npmInstallPackage(opId, folder, name, version, isDev);
  if (!result.ok) {
    document.getElementById('pkgmgr-log').innerText += 'Could not start: ' + result.error + '\n';
    pkgmgrActiveOpId = null;
    return;
  }
  document.getElementById('pkgmgr-add-name').value = '';
  document.getElementById('pkgmgr-add-version').value = '';
}

async function uninstallPackage(name) {
  const folder = activeProjectFolder();
  if (!folder) return;
  if (!confirm(`Remove "${name}" from this project?`)) return;

  const opId = startPkgmgrOp(`Removing ${name}…`);
  const result = await window.nexus.npmUninstallPackage(opId, folder, name);
  if (!result.ok) {
    document.getElementById('pkgmgr-log').innerText += 'Could not start: ' + result.error + '\n';
    pkgmgrActiveOpId = null;
  }
}

async function updatePackage(name) {
  const folder = activeProjectFolder();
  if (!folder) return;

  const opId = startPkgmgrOp(`Updating ${name}…`);
  const result = await window.nexus.npmUpdatePackage(opId, folder, name);
  if (!result.ok) {
    document.getElementById('pkgmgr-log').innerText += 'Could not start: ' + result.error + '\n';
    pkgmgrActiveOpId = null;
  }
}

async function toggleDockerPanel() {
  const overlay = document.getElementById('docker-overlay');
  const isOpen = overlay.classList.contains('open');
  if (isOpen) { closeDockerPanel(); return; }

  dockTray('docker-overlay');

  const statusLabel = document.getElementById('docker-status-label');
  statusLabel.innerText = 'checking…';
  const check = await window.nexus.dockerCheck();
  if (!check.installed) {
    statusLabel.innerText = 'Docker not found on this machine.';
  } else if (!check.running) {
    statusLabel.innerText = 'Installed, but the Docker daemon isn\'t running.';
  } else {
    statusLabel.innerText = `connected (v${check.version})`;
  }

  const folder = activeProjectFolder();
  const p = projects.find((x) => x.id === activeProjectId);
  document.getElementById('docker-project-name').innerText = p ? p.name : 'none';

  if (folder) {
    const detect = await window.nexus.dockerDetectProject(folder);
    if (!detect.hasDockerfile) {
      document.getElementById('docker-build-log').style.display = 'block';
      document.getElementById('docker-build-log').innerText = 'No Dockerfile found in this project - Build will not work until one exists.';
    }
  }

  await refreshDockerContainers();
}

function closeDockerPanel() {
  document.getElementById('docker-overlay').classList.remove('open');
}

async function startDockerBuild() {
  const folder = activeProjectFolder();
  if (!folder) { alert('No active project.'); return; }
  const tag = document.getElementById('docker-build-tag').value.trim();
  if (!tag) { alert('Enter an image tag, e.g. my-app:latest'); return; }

  const logEl = document.getElementById('docker-build-log');
  logEl.style.display = 'block';
  logEl.innerText = '';
  document.getElementById('docker-build-tag').disabled = true;

  const result = await window.nexus.dockerBuild(folder, tag);
  if (!result.ok) {
    logEl.innerText = 'Could not start build: ' + result.error;
    document.getElementById('docker-build-tag').disabled = false;
  } else {
    dockerBuildInProgress = tag;
  }
  // Further output streams in via onDockerBuildLog / onDockerBuildDone.
}

async function startDockerRun() {
  const image = document.getElementById('docker-run-image').value.trim();
  const containerName = document.getElementById('docker-run-name').value.trim();
  const hostPort = document.getElementById('docker-run-hostport').value.trim();
  const containerPort = document.getElementById('docker-run-containerport').value.trim();

  if (!image || !containerName) { alert('Enter an image name and a container name.'); return; }

  const result = await window.nexus.dockerRun(image, containerName, hostPort, containerPort);
  if (!result.ok) { alert('Run failed: ' + result.error); return; }
  await refreshDockerContainers();
}

async function refreshDockerContainers() {
  const listEl = document.getElementById('docker-containers-list');
  const result = await window.nexus.dockerPs();
  if (!result.ok) { listEl.innerHTML = `<p class="muted small">${escapeHtml(result.error)}</p>`; return; }
  if (result.containers.length === 0) { listEl.innerHTML = '<p class="muted small">No containers.</p>'; return; }

  listEl.innerHTML = result.containers.map((c) => {
    const isRunning = c.status.toLowerCase().startsWith('up');
    return `
      <div class="dk-container-row">
        <span class="dk-container-status ${isRunning ? 'running' : ''}">${isRunning ? '●' : '○'}</span>
        <span class="dk-container-name" title="${escapeHtml(c.image)}">${escapeHtml(c.names)}</span>
        <span class="dk-container-status">${escapeHtml(c.ports || c.status)}</span>
        <button class="btn tiny btn-secondary" onclick="viewDockerLogs('${escapeHtml(c.names)}')">Logs</button>
        ${isRunning
          ? `<button class="btn tiny btn-secondary" onclick="stopDockerContainer('${escapeHtml(c.names)}')">Stop</button>`
          : `<button class="btn tiny btn-secondary" onclick="removeDockerContainer('${escapeHtml(c.names)}')">Remove</button>`}
      </div>
    `;
  }).join('');
}

async function stopDockerContainer(name) {
  const result = await window.nexus.dockerStop(name);
  if (!result.ok) { alert('Stop failed: ' + result.error); return; }
  await refreshDockerContainers();
}

async function removeDockerContainer(name) {
  if (!confirm(`Remove container "${name}"? This deletes the container (not the image).`)) return;
  const result = await window.nexus.dockerRemove(name);
  if (!result.ok) { alert('Remove failed: ' + result.error); return; }
  await refreshDockerContainers();
}

async function viewDockerLogs(name) {
  document.getElementById('docker-logs-card').style.display = 'block';
  document.getElementById('docker-logs-container-name').innerText = name;
  document.getElementById('docker-container-logs').innerText = '';
  await window.nexus.dockerStreamLogs(name);
}

async function toggleApiTester() {
  const overlay = document.getElementById('api-tester-overlay');
  const isOpen = overlay.classList.contains('open');
  if (isOpen) { closeApiTester(); return; }

  apiCurrentFolder = activeProjectFolder();
  dockTray('api-tester-overlay');

  if (apiCurrentFolder) {
    const result = await window.nexus.apiLoadCollection(apiCurrentFolder);
    apiSavedRequests = result.ok ? result.requests : [];
    if (!result.ok) console.error('Could not load saved API requests:', result.error);
  } else {
    apiSavedRequests = [];
  }
  renderApiSavedList();
}

function closeApiTester() {
  document.getElementById('api-tester-overlay').classList.remove('open');
}

function renderApiSavedList() {
  const listEl = document.getElementById('api-saved-list');
  if (apiSavedRequests.length === 0) {
    listEl.innerHTML = `<p class="muted small" style="padding:10px;">${apiCurrentFolder ? 'No saved requests yet.' : 'No active project - requests can still be sent, but nothing can be saved.'}</p>`;
    return;
  }
  listEl.innerHTML = apiSavedRequests.map((r, i) => `
    <div class="api-saved-item" onclick="loadApiRequestIntoForm(${i})">
      <span class="api-saved-item-method">${escapeHtml(r.method)}</span>
      <span class="api-saved-item-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
      <span class="api-saved-item-delete" onclick="deleteApiSavedRequest(${i}, event)">✕</span>
    </div>
  `).join('');
}

function loadApiRequestIntoForm(index) {
  const r = apiSavedRequests[index];
  if (!r) return;
  document.getElementById('api-method').value = r.method;
  document.getElementById('api-url').value = r.url;
  document.getElementById('api-headers').value = r.headersText || '';
  document.getElementById('api-body').value = r.body || '';
}

async function saveCurrentApiRequest() {
  if (!apiCurrentFolder) { alert('No active project - open one from the Projects tab to save requests.'); return; }
  const url = document.getElementById('api-url').value.trim();
  if (!url) { alert('Enter a URL first.'); return; }

  const name = prompt('Name this request:', url);
  if (!name) return;

  apiSavedRequests.push({
    name,
    method: document.getElementById('api-method').value,
    url,
    headersText: document.getElementById('api-headers').value,
    body: document.getElementById('api-body').value,
  });

  const result = await window.nexus.apiSaveCollection(apiCurrentFolder, apiSavedRequests);
  if (!result.ok) { alert('Could not save: ' + result.error); return; }
  renderApiSavedList();
}

async function deleteApiSavedRequest(index, e) {
  e.stopPropagation();
  if (!confirm(`Delete saved request "${apiSavedRequests[index]?.name}"?`)) return;
  apiSavedRequests.splice(index, 1);
  await window.nexus.apiSaveCollection(apiCurrentFolder, apiSavedRequests);
  renderApiSavedList();
}

async function sendApiRequest() {
  const method = document.getElementById('api-method').value;
  const url = document.getElementById('api-url').value.trim();
  const headersText = document.getElementById('api-headers').value;
  const body = document.getElementById('api-body').value;
  const statusEl = document.getElementById('api-response-status');
  const bodyEl = document.getElementById('api-response-body');

  if (!url) { alert('Enter a URL.'); return; }

  statusEl.className = 'muted small';
  statusEl.innerText = 'Sending…';
  bodyEl.innerText = '';

  const result = await window.nexus.apiSendRequest(method, url, headersText, body);

  if (!result.ok) {
    statusEl.className = 'status-err';
    statusEl.innerText = `Request failed after ${result.timeMs}ms: ${result.error}`;
    return;
  }

  statusEl.className = result.status < 400 ? 'status-ok' : 'status-err';
  statusEl.innerText = `${result.status} ${result.statusText} — ${result.timeMs}ms`;

  let displayBody = result.body;
  try {
    displayBody = JSON.stringify(JSON.parse(result.body), null, 2);
  } catch {
    // not JSON - show as-is
  }
  const headerLines = Object.entries(result.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  bodyEl.innerText = `--- Response Headers ---\n${headerLines}\n\n--- Body ---\n${displayBody}`;
}

async function toggleCodeEditor() {
  const overlay = document.getElementById('code-editor-overlay');
  const isOpen = overlay.classList.contains('open');
  if (isOpen) { closeCodeEditor(); return; }

  codeEditorFolder = activeProjectFolder();
  const p = projects.find((x) => x.id === activeProjectId);
  document.getElementById('editor-project-name').innerText = p ? p.name : 'No active project';

  if (!codeEditorFolder) {
    alert('No active project. Launch or select one from the Projects tab first.');
    return;
  }

  dockTray('code-editor-overlay');

  if (!codeEditorCM) {
    codeEditorCM = CodeMirror(document.getElementById('code-editor-cm-container'), {
      value: '',
      lineNumbers: true,
      theme: 'default',
      autoCloseBrackets: true,
      matchBrackets: true,
      tabSize: 2,
      indentUnit: 2,
    });
    codeEditorCM.on('change', () => {
      const entry = codeEditorOpenFiles.find((f) => f.relPath === codeEditorCurrentRelPath);
      if (entry) {
        entry.dirty = true;
        entry.content = codeEditorCM.getValue();
        renderCodeEditorTabs();
        clearTimeout(languageDiagnosticsTimer);
        languageDiagnosticsTimer = setTimeout(() => editorLanguageAction('diagnostics', { quiet: true }), 500);
      }
    });
    codeEditorCM.setOption('extraKeys', {
      'Ctrl-S': () => { saveCurrentEditorFile(); return false; },
      'Cmd-S': () => { saveCurrentEditorFile(); return false; },
      'Ctrl-Space': () => { editorLanguageAction('complete'); return false; },
      'F12': () => { editorLanguageAction('definition'); return false; },
      'Shift-F12': () => { editorLanguageAction('references'); return false; },
      'F2': () => { editorLanguageAction('rename'); return false; },
    });
    applyNexusPreferences();
  }
  // The dock's width animates in over .32s (see .tray-overlay in
  // index.html), so CodeMirror must re-measure once that settles - it
  // sizes itself off the container's width at refresh time, not live.
  setTimeout(() => codeEditorCM.refresh(), 340);

  await refreshCodeEditorTree();

  codeEditorLintTools = await window.nexus.detectLintTools(codeEditorFolder);
  const formatBtn = document.getElementById('ce-format-btn');
  const formatOnSaveRow = document.getElementById('ce-format-on-save-row');
  const available = codeEditorLintTools.hasEslint || codeEditorLintTools.hasPrettier;
  formatBtn.style.display = available ? 'inline-block' : 'none';
  formatOnSaveRow.style.display = available ? 'flex' : 'none';
  document.getElementById('ce-lint-summary').innerText = '';
  document.getElementById('ce-lint-panel').classList.remove('open');
}

function closeCodeEditor() {
  const dirtyCount = codeEditorOpenFiles.filter((f) => f.dirty).length;
  if (dirtyCount > 0 && !confirm(`${dirtyCount} file(s) have unsaved changes. Close anyway? (Nothing is lost - just close this panel and reopen to continue editing, or Save first.)`)) {
    return;
  }
  document.getElementById('code-editor-overlay').classList.remove('open');
  closeCodeLibraryPreview();
  closeDiagnosticLesson();
}

async function refreshCodeEditorTree() {
  const files = await window.nexus.listProjectFiles(codeEditorFolder);
  const tree = buildCodeEditorTree(files);
  renderCodeEditorTree(tree);
}

function buildCodeEditorTree(files) {
  const root = { name: '', type: 'folder', children: {}, relPath: '' };
  for (const relFile of files) {
    const parts = relFile.split(/[\\/]/).filter(Boolean);
    let node = root;
    let pathSoFar = '';
    parts.forEach((part, i) => {
      pathSoFar = pathSoFar ? pathSoFar + '/' + part : part;
      const isFile = i === parts.length - 1;
      if (!node.children[part]) {
        node.children[part] = { name: part, type: isFile ? 'file' : 'folder', children: {}, relPath: pathSoFar };
      }
      node = node.children[part];
    });
  }
  return root;
}

function renderCodeEditorTree(root) {
  const container = document.getElementById('code-editor-filetree');
  container.innerHTML = renderCodeEditorTreeNode(root, 0);
}

function renderCodeEditorTreeNode(node, depth) {
  const entries = Object.values(node.children).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries.map((entry) => {
    const indent = 10 + depth * 16;
    if (entry.type === 'folder') {
      const isExpanded = codeEditorExpandedFolders.has(entry.relPath);
      return `
        <div class="cet-row cet-folder" style="padding-left:${indent}px;" onclick="toggleCodeEditorFolder('${escapeHtml(entry.relPath)}')">
          ${isExpanded ? '📂' : '📁'} ${escapeHtml(entry.name)}
        </div>
        ${isExpanded ? `<div>${renderCodeEditorTreeNode(entry, depth + 1)}</div>` : ''}
      `;
    }
    const isActive = entry.relPath === codeEditorCurrentRelPath;
    return `
      <div class="cet-row ${isActive ? 'active' : ''}" style="padding-left:${indent}px;" onclick="openFileInEditor('${escapeHtml(entry.relPath)}')">
        📄 ${escapeHtml(entry.name)}
      </div>
    `;
  }).join('');
}

function toggleCodeEditorFolder(relPath) {
  if (codeEditorExpandedFolders.has(relPath)) {
    codeEditorExpandedFolders.delete(relPath);
  } else {
    codeEditorExpandedFolders.add(relPath);
  }
  refreshCodeEditorTree();
}

async function openFileInEditor(relPath) {
  let entry = codeEditorOpenFiles.find((f) => f.relPath === relPath);
  if (!entry) {
    const absPath = editorAbsPath(codeEditorFolder, relPath);
    const result = await window.nexus.readFile(absPath);
    if (!result.ok) { alert('Could not open file: ' + result.error); return; }
    entry = { relPath, absPath, content: result.content, dirty: false };
    codeEditorOpenFiles.push(entry);
  }
  codeEditorCurrentRelPath = relPath;
  document.getElementById('code-editor-empty').style.display = 'none';
  document.getElementById('code-editor-cm-container').style.display = 'block';
  codeEditorCM.setOption('mode', codeEditorModeFor(relPath));
  codeEditorCM.setValue(entry.content);
  codeEditorCM.clearHistory();
  document.getElementById('editor-current-file').innerText = relPath;
  document.getElementById('ce-prompt-filepath').value = relPath;
  document.getElementById('ce-lint-summary').innerText = '';
  document.getElementById('ce-lint-panel').classList.remove('open');
  document.getElementById('ce-lint-panel').innerHTML = '';
  renderCodeEditorTabs();
  refreshCodeEditorTree(); // update active highlight in tree
  setTimeout(() => codeEditorCM.focus(), 30);
}

function renderCodeEditorTabs() {
  const bar = document.getElementById('code-editor-tabbar');
  bar.innerHTML = codeEditorOpenFiles.map((f) => `
    <div class="cet-tab ${f.relPath === codeEditorCurrentRelPath ? 'active' : ''}" onclick="openFileInEditor('${escapeHtml(f.relPath)}')">
      ${f.dirty ? '<span class="cet-tab-dirty"></span>' : ''}
      ${escapeHtml(f.relPath.split('/').pop())}
      <span class="cet-tab-close" onclick="event.stopPropagation(); closeEditorTab('${escapeHtml(f.relPath)}')">✕</span>
    </div>
  `).join('');
}

function closeEditorTab(relPath) {
  const entry = codeEditorOpenFiles.find((f) => f.relPath === relPath);
  if (entry?.dirty && !confirm(`${relPath} has unsaved changes. Close without saving?`)) return;
  codeEditorOpenFiles = codeEditorOpenFiles.filter((f) => f.relPath !== relPath);
  if (codeEditorCurrentRelPath === relPath) {
    codeEditorCurrentRelPath = null;
    if (codeEditorOpenFiles.length > 0) {
      openFileInEditor(codeEditorOpenFiles[codeEditorOpenFiles.length - 1].relPath);
    } else {
      document.getElementById('code-editor-cm-container').style.display = 'none';
      document.getElementById('code-editor-empty').style.display = 'flex';
      document.getElementById('editor-current-file').innerText = 'No file open';
    }
  }
  renderCodeEditorTabs();
}

let codeEditorLintTools = { hasEslint: false, hasPrettier: false };
let lastDiagnosticMessages = [];
let pendingDiagnosticLesson = null;

async function saveCurrentEditorFile() {
  const entry = codeEditorOpenFiles.find((f) => f.relPath === codeEditorCurrentRelPath);
  if (!entry) { alert('No file open to save.'); return; }
  const content = codeEditorCM.getValue();
  const result = await window.nexus.applyFileChange(entry.absPath, content, 'Manual edit (Code Editor)');
  if (!result.ok) { alert('Save failed: ' + result.error); return; }
  entry.content = content;
  entry.dirty = false;
  renderCodeEditorTabs();
  const statusEl = document.getElementById('editor-current-file');
  const original = entry.relPath;
  statusEl.innerText = `Saved ${original}${result.backupPath ? ' (backed up)' : ''}`;
  setTimeout(() => { if (codeEditorCurrentRelPath === original) statusEl.innerText = original; }, 2000);

  const formatOnSave = document.getElementById('ce-format-on-save')?.checked;
  if (formatOnSave && (codeEditorLintTools.hasEslint || codeEditorLintTools.hasPrettier)) {
    await runFormatAndLint(entry);
  }
}

async function formatCurrentEditorFile() {
  const entry = codeEditorOpenFiles.find((f) => f.relPath === codeEditorCurrentRelPath);
  if (!entry) { alert('No file open.'); return; }
  // Format needs the on-disk content to be current, so save first (silently,
  // reusing the same real write path) before running the formatter over it.
  const content = codeEditorCM.getValue();
  const saveResult = await window.nexus.applyFileChange(entry.absPath, content, 'Manual edit (pre-format save)');
  if (!saveResult.ok) { alert('Could not save before formatting: ' + saveResult.error); return; }
  entry.content = content;
  entry.dirty = false;
  renderCodeEditorTabs();
  await runFormatAndLint(entry);
}

async function runFormatAndLint(entry) {
  const btn = document.getElementById('ce-format-btn');
  const originalLabel = btn.innerText;
  btn.disabled = true;
  btn.innerText = '⋯';

  const result = await window.nexus.formatAndLintFile(codeEditorFolder, entry.absPath);

  btn.disabled = false;
  btn.innerText = originalLabel;

  if (!result.ok) {
    alert('Format/lint failed: ' + result.error);
    return;
  }

  entry.content = result.newContent;
  if (codeEditorCurrentRelPath === entry.relPath) {
    const cursor = codeEditorCM.getCursor();
    codeEditorCM.setValue(result.newContent);
    codeEditorCM.setCursor(cursor);
  }
  entry.dirty = false;
  renderCodeEditorTabs();
  renderLintResults(result.lintMessages || []);
}

function renderLintResults(messages) {
  lastDiagnosticMessages = messages;
  const summaryEl = document.getElementById('ce-lint-summary');
  const panelEl = document.getElementById('ce-lint-panel');

  if (messages.length === 0) {
    summaryEl.innerText = '✓ No lint issues';
    panelEl.classList.remove('open');
    panelEl.innerHTML = '';
    return;
  }

  const errorCount = messages.filter((m) => m.severity === 'error').length;
  const warnCount = messages.length - errorCount;
  summaryEl.innerHTML = `<span style="cursor:pointer;" onclick="document.getElementById('ce-lint-panel').classList.toggle('open')">${errorCount} error(s), ${warnCount} warning(s)</span>`;

  panelEl.innerHTML = messages.map((m, index) => `
    <div class="ce-lint-item ce-lint-${m.severity}" onclick="jumpToLintLine(${m.line})">
      <span class="ce-lint-dot">●</span>
      <span class="ce-lint-line">Line ${m.line}</span>
      <span>${escapeHtml(m.message)}</span>
      <span class="ce-lint-rule">${escapeHtml(m.ruleId || '')}</span>
      <button class="btn tiny btn-secondary ce-learn-button" onclick="event.stopPropagation(); explainDiagnostic(${index})">Explain &amp; Learn</button>
    </div>
  `).join('');
  panelEl.classList.add('open');
}

function jumpToLintLine(lineNumber) {
  const line = Math.max(0, lineNumber - 1);
  codeEditorCM.setCursor({ line, ch: 0 });
  codeEditorCM.scrollIntoView({ line, ch: 0 }, 100);
  const marker = codeEditorCM.addLineClass(line, 'background', 'cet-search-jump-highlight');
  setTimeout(() => codeEditorCM.removeLineClass(line, 'background', 'cet-search-jump-highlight'), 1500);
}


// ---------- Prompt-driven coding, inside the Code Editor ----------
// Lets you ask the model to write or modify any file - the currently open one,
// or a brand-new path - without leaving the editor. Every AI-written change
// still goes through the same approve/reject diff review as everywhere else
// in Nexus before touching disk; nothing is ever auto-applied here.
let pendingEditorPromptResult = null;
let ceAttachments = []; // [{ type: 'file'|'terminal', label, content }]

function ceAutoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
  document.getElementById('ce-send-btn').disabled = !textarea.value.trim();
}

function ceHandleKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitEditorPrompt();
  }
  // Shift+Enter falls through and inserts a normal newline.
}

function toggleCePlusMenu(e) {
  e.stopPropagation();
  document.getElementById('ce-plus-menu').classList.toggle('open');
}

// Close the plus-menu on any click outside it (registered once).
document.addEventListener('click', (e) => {
  const menu = document.getElementById('ce-plus-menu');
  if (menu && !menu.contains(e.target) && e.target.id !== 'ce-plus-btn') {
    menu.classList.remove('open');
  }
});

function renderCeAttachments() {
  const row = document.getElementById('ce-attachments-row');
  row.innerHTML = ceAttachments.map((a, i) => `
    <span class="ce-chip">
      ${a.type === 'terminal' ? '🖥️' : '📎'} ${escapeHtml(a.label)}
      <span class="ce-chip-remove" onclick="ceRemoveAttachment(${i})">✕</span>
    </span>
  `).join('');
}

function ceRemoveAttachment(index) {
  ceAttachments.splice(index, 1);
  renderCeAttachments();
}

function ceIncludeTerminal() {
  document.getElementById('ce-plus-menu').classList.remove('open');
  const text = document.getElementById('terminal-screen').innerText.slice(-3000);
  if (!text.trim()) { alert('Terminal is empty - nothing to include.'); return; }
  ceAttachments.push({ type: 'terminal', label: 'Recent terminal output', content: text });
  renderCeAttachments();
}

function ceOpenFeatureBuilder() {
  document.getElementById('ce-plus-menu').classList.remove('open');
  if (!confirm('Feature Builder plans changes across multiple files, with a separate approval for each one - better suited to bigger asks than this single-file prompt bar. Switch there now? (This closes the Code Editor.)')) {
    return;
  }
  closeCodeEditor();
  switchTab('workspace');
  setTimeout(() => document.getElementById('feature-description')?.focus(), 100);
}

async function ceAttachFile() {
  document.getElementById('ce-plus-menu').classList.remove('open');
  if (!codeEditorFolder) { alert('No active project.'); return; }
  const files = await window.nexus.listProjectFiles(codeEditorFolder);
  ceFilePickerAllFiles = files;
  document.getElementById('ce-file-picker-search').value = '';
  renderCeFilePickerList();
  document.getElementById('ce-file-picker-overlay').style.display = 'block';
  setTimeout(() => document.getElementById('ce-file-picker-search').focus(), 30);
}

let ceFilePickerAllFiles = [];

function renderCeFilePickerList() {
  const filter = document.getElementById('ce-file-picker-search').value.trim().toLowerCase();
  const matches = ceFilePickerAllFiles.filter((f) => !filter || f.toLowerCase().includes(filter)).slice(0, 100);
  document.getElementById('ce-file-picker-list').innerHTML = matches.map((f) => `
    <div class="ce-file-picker-item" onclick="ceSelectFileForAttachment('${escapeHtml(f)}')">${escapeHtml(f)}</div>
  `).join('') || '<div class="ce-file-picker-item muted">No matching files</div>';
}

async function ceSelectFileForAttachment(relPath) {
  closeCeFilePicker();
  const absPath = editorAbsPath(codeEditorFolder, relPath);
  const result = await window.nexus.readFile(absPath);
  if (!result.ok) { alert('Could not attach file: ' + result.error); return; }
  ceAttachments.push({ type: 'file', label: relPath, content: result.content });
  renderCeAttachments();
}

function closeCeFilePicker() {
  document.getElementById('ce-file-picker-overlay').style.display = 'none';
}

// ---------- Project-wide search & replace ----------
function showCodeEditorFileTree() {
  document.getElementById('cet-mode-files-btn').classList.add('active');
  document.getElementById('cet-mode-search-btn').classList.remove('active');
  document.getElementById('cet-mode-library-btn').classList.remove('active');
  document.getElementById('code-editor-filetree').style.display = 'block';
  document.getElementById('code-editor-search-panel').style.display = 'none';
  document.getElementById('code-editor-library-panel').style.display = 'none';
}

function showCodeEditorSearch() {
  document.getElementById('cet-mode-files-btn').classList.remove('active');
  document.getElementById('cet-mode-search-btn').classList.add('active');
  document.getElementById('cet-mode-library-btn').classList.remove('active');
  document.getElementById('code-editor-filetree').style.display = 'none';
  document.getElementById('code-editor-search-panel').style.display = 'flex';
  document.getElementById('code-editor-library-panel').style.display = 'none';
  setTimeout(() => document.getElementById('ce-search-query').focus(), 30);
}

let lastSearchResults = null;

async function runProjectSearch() {
  const query = document.getElementById('ce-search-query').value.trim();
  const caseSensitive = document.getElementById('ce-search-case').checked;
  const summaryEl = document.getElementById('ce-search-summary');
  const resultsEl = document.getElementById('ce-search-results');

  if (!query) { resultsEl.innerHTML = ''; summaryEl.innerText = ''; lastSearchResults = null; return; }
  if (!codeEditorFolder) { alert('No active project.'); return; }

  summaryEl.innerText = 'Searching…';
  const result = await window.nexus.searchProject(codeEditorFolder, query, caseSensitive);

  if (!result.ok) { summaryEl.innerText = 'Error: ' + result.error; resultsEl.innerHTML = ''; return; }

  lastSearchResults = result;
  const fileCount = new Set(result.matches.map((m) => m.relPath)).size;
  summaryEl.innerText = result.matches.length === 0
    ? 'No matches found.'
    : `${result.matches.length} match(es) in ${fileCount} file(s)${result.truncated ? ' (showing first ' + result.matches.length + ')' : ''}`;

  const byFile = {};
  for (const m of result.matches) {
    if (!byFile[m.relPath]) byFile[m.relPath] = [];
    byFile[m.relPath].push(m);
  }

  resultsEl.innerHTML = Object.entries(byFile).map(([relPath, lineMatches]) => `
    <div class="cet-search-file-group">📄 ${escapeHtml(relPath)}</div>
    ${lineMatches.map((m) => `
      <div class="cet-search-result" onclick="jumpToSearchResult('${escapeHtml(relPath)}', ${m.lineNumber})">
        <span class="cet-line-num">${m.lineNumber}</span>${escapeHtml(m.lineText.trim())}
      </div>
    `).join('')}
  `).join('');
}

async function jumpToSearchResult(relPath, lineNumber) {
  await openFileInEditor(relPath);
  const line = lineNumber - 1;
  codeEditorCM.setCursor({ line, ch: 0 });
  codeEditorCM.scrollIntoView({ line, ch: 0 }, 100);
  // Brief highlight so the target line is easy to spot after jumping.
  const marker = codeEditorCM.addLineClass(line, 'background', 'cet-search-jump-highlight');
  setTimeout(() => codeEditorCM.removeLineClass(line, 'background', 'cet-search-jump-highlight'), 1500);
}

async function runProjectReplaceAll() {
  const query = document.getElementById('ce-search-query').value.trim();
  const replacement = document.getElementById('ce-search-replacement').value;
  const caseSensitive = document.getElementById('ce-search-case').checked;

  if (!query) { alert('Enter something to search for first.'); return; }
  if (!codeEditorFolder) { alert('No active project.'); return; }

  // Make sure the summary reflects this exact query/case setting before
  // asking for confirmation, so the count in the dialog is accurate.
  await runProjectSearch();
  if (!lastSearchResults || lastSearchResults.matches.length === 0) {
    alert('No matches to replace.');
    return;
  }

  const affectedFiles = [...new Set(lastSearchResults.matches.map((m) => m.relPath))];
  const dirtyAffected = codeEditorOpenFiles.filter((f) => f.dirty && affectedFiles.includes(f.relPath));
  let warning = '';
  if (dirtyAffected.length > 0) {
    warning = `\n\nWARNING: ${dirtyAffected.length} of these file(s) have unsaved manual edits open in the editor - those in-memory changes will be overwritten by this replace.`;
  }

  if (!confirm(
    `Replace "${query}" with "${replacement}" across ${lastSearchResults.matches.length} match(es) in ${affectedFiles.length} file(s)?\n\n` +
    `Each changed file is backed up to .bak first, same as any other write in Nexus.${warning}`
  )) return;

  const result = await window.nexus.replaceInProject(codeEditorFolder, query, replacement, caseSensitive);
  if (!result.ok) { alert('Replace failed: ' + result.error); return; }

  showToast('success', 'Replace All complete', `${result.totalOccurrences} occurrence(s) across ${result.filesChanged.length} file(s).`);

  // Any open file that got changed on disk needs its in-memory copy synced,
  // so Save doesn't later clobber the replace with stale content.
  for (const relPath of result.filesChanged) {
    const openEntry = codeEditorOpenFiles.find((f) => f.relPath === relPath);
    if (openEntry) {
      const fresh = await window.nexus.readFile(openEntry.absPath);
      if (fresh.ok) {
        openEntry.content = fresh.content;
        openEntry.dirty = false;
        if (codeEditorCurrentRelPath === relPath) {
          codeEditorCM.setValue(fresh.content);
          codeEditorCM.clearHistory();
        }
      }
    }
  }
  renderCodeEditorTabs();
  await runProjectSearch(); // refresh result list to reflect the replacement
}

async function submitEditorPrompt() {
  const relPath = document.getElementById('ce-prompt-filepath').value.trim();
  const rawInstruction = document.getElementById('ce-prompt-instruction').value.trim();

  if (!relPath) { alert('Enter a target file path - the file currently open, or a new one to create.'); return; }
  if (!rawInstruction) { alert('Describe what the model should write or change.'); return; }
  if (!codeEditorFolder) { alert('No active project.'); return; }

  // Fold any attached files/terminal output into the instruction as clearly
  // labeled extra context, ahead of the actual request.
  const contextBlocks = ceAttachments.map((a) =>
    `--- ADDITIONAL CONTEXT: ${a.label} ---\n${a.content}\n--- END CONTEXT ---`
  );
  const instruction = contextBlocks.length > 0
    ? contextBlocks.join('\n\n') + '\n\nREQUEST:\n' + rawInstruction
    : rawInstruction;

  const sendBtn = document.getElementById('ce-send-btn');
  const textarea = document.getElementById('ce-prompt-instruction');
  sendBtn.disabled = true;
  textarea.disabled = true;
  const originalArrow = sendBtn.innerText;
  sendBtn.innerText = '⋯';

  const absPath = editorAbsPath(codeEditorFolder, relPath);
  const result = await window.nexus.aiEditFileWithPrompt(absPath, instruction, codeEditorFolder);

  sendBtn.innerText = originalArrow;
  textarea.disabled = false;

  if (!result.ok) {
    sendBtn.disabled = !textarea.value.trim();
    if (result.raw) console.error('Raw AI response that failed to parse:', result.raw);
    alert('Generation failed: ' + result.error);
    return;
  }

  // Clear the composer for the next request - the diff review below still
  // shows exactly what was asked for and what came back.
  textarea.value = '';
  textarea.style.height = 'auto';
  sendBtn.disabled = true;
  ceAttachments = [];
  renderCeAttachments();

  pendingEditorPromptResult = { ...result, relPath };
  const checkerProblems = result.checker?.diagnostics || [];
  document.getElementById('ce-diff-explanation').innerText = `${result.explanation || ''}${checkerProblems.length ? `\n\nCode checker (${result.checker.language}): ${checkerProblems.map((item) => `line ${item.line + 1}: ${item.message}`).join(' | ')}` : `\n\nCode checker: no problems reported${result.checker?.available === false ? ' by the limited available checker' : ''}.`}`;
  document.getElementById('ce-diff-before').innerText = result.oldContent || '(empty - this file does not exist yet)';
  document.getElementById('ce-diff-after').innerText = result.newContent;
  document.getElementById('code-editor-diff-overlay').style.display = 'flex';
}

async function approveEditorPrompt() {
  if (!pendingEditorPromptResult) return;
  const { filePath, newContent, relPath } = pendingEditorPromptResult;

  const existingEntry = codeEditorOpenFiles.find((f) => f.relPath === relPath);
  if (existingEntry?.dirty) {
    if (!confirm(`${relPath} has unsaved manual edits in the editor. Approving this AI change will overwrite them with the AI's version. Continue?`)) {
      return;
    }
  }

  const result = await window.nexus.applyFileChange(filePath, newContent, 'AI prompt (Code Editor)');
  if (!result.ok) { alert('Failed to write file: ' + result.error); return; }

  document.getElementById('code-editor-diff-overlay').style.display = 'none';
  pendingEditorPromptResult = null;
  document.getElementById('ce-prompt-instruction').value = '';

  await refreshCodeEditorTree();
  // Update (or create) the in-memory open-file entry directly with the
  // approved content, then display it - avoids a redundant disk re-read.
  let entry = codeEditorOpenFiles.find((f) => f.relPath === relPath);
  if (!entry) {
    entry = { relPath, absPath: filePath, content: newContent, dirty: false };
    codeEditorOpenFiles.push(entry);
  } else {
    entry.content = newContent;
    entry.dirty = false;
  }
  codeEditorCurrentRelPath = relPath;
  document.getElementById('code-editor-empty').style.display = 'none';
  document.getElementById('code-editor-cm-container').style.display = 'block';
  codeEditorCM.setOption('mode', codeEditorModeFor(relPath));
  codeEditorCM.setValue(newContent);
  codeEditorCM.clearHistory();
  document.getElementById('editor-current-file').innerText = `${relPath} (AI-written, saved)`;
  renderCodeEditorTabs();
}

function rejectEditorPrompt() {
  pendingEditorPromptResult = null;
  document.getElementById('code-editor-diff-overlay').style.display = 'none';
}

// Stream real process output into the log panel.
window.nexus.onProjectLog(({ id, text }) => {
  const p = projects.find((x) => x.id === id);
  if (!p || id !== activeProjectId) return;
  const log = document.getElementById('log-screen');
  log.innerText += text;
  log.scrollTop = log.scrollHeight;
});

window.nexus.onProjectClosed(({ id }) => {
  const p = projects.find((x) => x.id === id);
  if (p) p.running = false;
  if (id === activeProjectId) setPreviewVisible(false);
  persistProjects();
  renderProjects();
});

// Start hidden - nothing is running yet when Nexus first opens.
setPreviewVisible(false);

function clearLog() {
  document.getElementById('log-screen').innerText = '';
}

// ---------- Preview ----------
// The preview URL box is free-typed input. Without a check here, whatever
// text is in it gets handed straight to the <webview>'s src (or to the OS's
// external-browser opener) and rendered/navigated as if it were a trusted
// address - a "javascript:", "data:", or "file:" URL would then run in, or
// read from, that context (CodeQL: "DOM text reinterpreted as HTML"). Only
// plain http(s) addresses are allowed through.
function isSafePreviewUrl(raw) {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function loadPreview() {
  const url = document.getElementById('preview-url').value.trim();
  if (!url) return;
  if (!isSafePreviewUrl(url)) {
    alert('Preview URL must be a plain http:// or https:// address.');
    return;
  }
  document.getElementById('preview-frame').src = url;
}

function openInBrowser() {
  const url = document.getElementById('preview-url').value.trim();
  if (!url) return;
  if (!isSafePreviewUrl(url)) {
    alert('Preview URL must be a plain http:// or https:// address.');
    return;
  }
  window.nexus.openExternal(url);
}

function inspectPreview() {
  const webview = document.getElementById('preview-frame');
  if (webview && webview.isDevToolsOpened && webview.isDevToolsOpened()) {
    webview.closeDevTools();
  } else if (webview) {
    webview.openDevTools();
  }
}

async function clearPreviewCache() {
  const result = await window.nexus.clearPreviewCache();
  if (result.ok) {
    showToast('success', 'Preview cache cleared', 'Click Refresh (or relaunch the project) to reload cleanly.');
  } else {
    alert('Could not clear cache: ' + result.error);
  }
}

// ---------- Terminal ----------
async function handleTermKey(e) {
  if (e.key !== 'Enter') return;
  const input = document.getElementById('term-input');
  const cmd = input.value.trim();
  if (!cmd) return;
  const screen = document.getElementById('terminal-screen');
  const prompt = document.getElementById('term-prompt').innerText;
  screen.innerText += `${prompt} ${cmd}\n`;
  input.value = '';

  if (cmd === 'clear') {
    screen.innerText = '';
    return;
  }
  if (cmd === 'help') {
    screen.innerText += 'This runs real shell commands on your machine via Node. Try: dir/ls, pwd, cd <folder>, git status, npm -v\n';
    updatePrompt();
    return;
  }

  const { output, cwd } = await window.nexus.execCommand(cmd);
  if (output) screen.innerText += output + '\n';
  screen.scrollTop = screen.scrollHeight;
  updatePrompt(cwd);
}

async function updatePrompt(cwdMaybe) {
  const cwd = cwdMaybe || (await window.nexus.getCwd());
  document.getElementById('term-prompt').innerText = `${shorten(cwd)}$`;
}

function shorten(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

// ---------- Cloud / Gemini ----------
let codingModelProviderState = null;
let safeProviderDiscovery = null;

async function refreshCodingModels() {
  codingModelProviderState = await window.nexus.codingModelsStatus();
  if (!codingModelProviderState.ok) return;
  document.getElementById('coding-model-provider').value = codingModelProviderState.selected;
  renderCodingModelProvider();
}

async function explainDiagnostic(index) {
  const diagnostic = lastDiagnosticMessages[index];
  const entry = codeEditorOpenFiles.find((file) => file.relPath === codeEditorCurrentRelPath);
  if (!diagnostic || !entry || !codeEditorCM) return;
  jumpToLintLine(diagnostic.line);
  const overlay = document.getElementById('ce-learn-overlay');
  overlay.style.display = 'block';
  document.getElementById('ce-learn-diagnostic').innerText = `Line ${diagnostic.line} · ${diagnostic.ruleId || diagnostic.severity} · Preparing lesson…`;
  for (const id of ['what','why','practice','avoid','example']) document.getElementById(`ce-learn-${id}`).innerText = id === 'what' ? 'Asking your selected coding model…' : '';
  document.getElementById('ce-learn-before').innerText = codeEditorCM.getValue();
  document.getElementById('ce-learn-after').innerText = '';
  const result = await window.nexus.explainDiagnostic(codeEditorFolder, entry.absPath, codeEditorCM.getValue(), diagnostic);
  if (!result.ok) { closeDiagnosticLesson(); showToast('error', 'Explain & Learn failed', result.error); return; }
  pendingDiagnosticLesson = result;
  document.getElementById('ce-learn-diagnostic').innerText = `Line ${result.diagnostic.line} · ${result.diagnostic.ruleId || result.diagnostic.severity} · Checker correction: ${result.checkerFixSource} · ${result.diagnostic.message}`;
  for (const id of ['what','why','practice','avoid','example']) document.getElementById(`ce-learn-${id}`).innerText = result.lesson[id] || 'No additional guidance returned.';
  document.getElementById('ce-learn-before').innerText = result.oldContent;
  document.getElementById('ce-learn-after').innerText = result.newContent;
}

function closeDiagnosticLesson() {
  const overlay = document.getElementById('ce-learn-overlay');
  if (overlay) overlay.style.display = 'none';
  pendingDiagnosticLesson = null;
}

async function applyDiagnosticLesson() {
  if (!pendingDiagnosticLesson) return;
  const lesson = pendingDiagnosticLesson;
  const result = await window.nexus.applyFileChange(lesson.filePath, lesson.newContent, 'Explain & Learn approved correction');
  if (!result.ok) { showToast('error', 'Correction was not applied', result.error); return; }
  const entry = codeEditorOpenFiles.find((file) => file.absPath === lesson.filePath);
  if (entry) { entry.content = lesson.newContent; entry.dirty = false; }
  codeEditorCM.setValue(lesson.newContent);
  renderCodeEditorTabs(); closeDiagnosticLesson();
  showToast('success', 'Correction applied', 'The approved change was saved with a backup. Nexus is checking the file again.');
  setTimeout(() => editorLanguageAction('diagnostics', { quiet:true }), 100);
}

function renderCodingModelProvider() {
  if (!codingModelProviderState?.ok) return;
  const id = document.getElementById('coding-model-provider').value;
  const item = codingModelProviderState.providers.find((provider) => provider.id === id);
  const selected = codingModelProviderState.selected === id ? 'Active' : 'Available';
  document.getElementById('coding-model-key').disabled = id === 'nim' || item?.keyless;
  document.getElementById('coding-model-key').placeholder = item?.keyless ? 'No API key required' : id === 'nim' ? 'Use NVIDIA key setting above' : `API key for ${item?.name || id}`;
  document.getElementById('coding-model-status').innerText = `${selected} · ${item?.model || ''} · ${item?.configured ? 'key saved' : 'no key saved'}`;
}

async function discoverSafeProviders() {
  const panel = document.getElementById('provider-discovery-results'); panel.innerHTML = '<p class="muted small">Checking localhost services and supported environment-variable names…</p>';
  safeProviderDiscovery = await window.nexus.discoverProviders();
  if (!safeProviderDiscovery.ok) { panel.innerHTML = `<p class="muted small">${escapeHtml(safeProviderDiscovery.error)}</p>`; return; }
  const locals = safeProviderDiscovery.localServices.map((service, serviceIndex) => `<div class="suggestion-item"><strong>${escapeHtml(service.name)}</strong><span class="muted small">Local and keyless · ${service.models.length} model(s)</span>${service.models.length ? `<select id="local-provider-model-${serviceIndex}">${service.models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('')}</select><button class="btn tiny" onclick="useDiscoveredLocalProvider(${serviceIndex})">Use locally</button>` : '<span class="muted small">No loaded models detected.</span>'}</div>`).join('');
  const keys = safeProviderDiscovery.environmentKeys.map((item, index) => `<div class="suggestion-item"><strong>${escapeHtml(item.name)}</strong><span class="muted small">Found ${escapeHtml(item.env)}; value remains hidden.</span><button class="btn tiny" onclick="approveEnvironmentKeyImport(${index})">Review &amp; import</button></div>`).join('');
  panel.innerHTML = `<p class="label">Local services</p>${locals || '<p class="muted small">Ollama and LM Studio were not detected on localhost.</p>'}<p class="label">Keys you already own</p>${keys || '<p class="muted small">No supported provider environment variables were detected.</p>'}`;
}

async function useDiscoveredLocalProvider(index) {
  const service = safeProviderDiscovery?.localServices[index]; if (!service) return;
  const model = document.getElementById(`local-provider-model-${index}`).value;
  if (!confirm(`Use ${service.name} model ${model} as Nexus's coding model? Requests will stay on this computer.`)) return;
  const result = await window.nexus.useLocalProviderModel(service.id, model);
  showToast(result.ok ? 'success' : 'error', result.ok ? 'Local model activated' : 'Could not activate local model', result.error || model); refreshCodingModels();
}

async function approveEnvironmentKeyImport(index) {
  const item = safeProviderDiscovery?.environmentKeys[index]; if (!item) return;
  if (!confirm(`Import your ${item.name} key from ${item.env} into Nexus encrypted storage? The key value will remain hidden and will not be sent to the interface.`)) return;
  const result = await window.nexus.importEnvironmentProviderKey(item.env);
  showToast(result.ok ? 'success' : 'error', result.ok ? `${item.name} key imported` : 'Key import failed', result.error || 'Stored with Windows encryption.');
  if (result.ok) { safeProviderDiscovery.environmentKeys.splice(index, 1); refreshCodingModels(); discoverSafeProviders(); }
}

async function saveCodingModelProviderKey() {
  const id = document.getElementById('coding-model-provider').value;
  const key = document.getElementById('coding-model-key').value.trim();
  if (!key) { alert('Enter the provider API key first.'); return; }
  const result = await window.nexus.saveCodingModelKey(id, key);
  if (result.ok) document.getElementById('coding-model-key').value = '';
  showToast(result.ok ? 'success' : 'error', result.ok ? 'Model key saved' : 'Could not save key', result.error || '');
  refreshCodingModels();
}

async function clearCodingModelProviderKey() {
  const id = document.getElementById('coding-model-provider').value;
  const result = await window.nexus.clearCodingModelKey(id);
  showToast(result.ok ? 'success' : 'error', result.ok ? 'Model key cleared' : 'Could not clear key', result.error || '');
  refreshCodingModels();
}

async function activateCodingModelProvider() {
  const id = document.getElementById('coding-model-provider').value;
  const result = await window.nexus.selectCodingModel(id);
  showToast(result.ok ? 'success' : 'error', result.ok ? 'Coding model changed' : 'Could not change model', result.error || '');
  refreshCodingModels();
}

async function askCodingModel() {
  const prompt = document.getElementById('coding-model-prompt').value.trim();
  if (!prompt) return;
  const box = document.getElementById('coding-model-response'); box.innerText = 'Asking selected coding model…';
  const project = projects.find((item) => item.id === activeProjectId);
  const result = await window.nexus.askCodingModel(prompt, project?.folder || null);
  box.innerText = result.ok ? result.text : `Error: ${result.error}`;
}

async function saveGeminiKey() {
  const key = document.getElementById('gemini-api-key').value.trim();
  if (!key) return;
  await window.nexus.saveGeminiKey(key);
  document.getElementById('gemini-api-key').value = '';
  refreshGeminiStatus();
}

async function clearGeminiKey() {
  await window.nexus.clearGeminiKey();
  refreshGeminiStatus();
}

async function refreshGeminiStatus() {
  const has = await window.nexus.hasGeminiKey();
  document.getElementById('gemini-status').innerText = has
    ? 'A key is saved (encrypted on disk).'
    : 'No key saved yet.';
}

async function saveNimKey() {
  const key = document.getElementById('nim-api-key').value.trim();
  if (!key) return;
  await window.nexus.saveNimKey(key);
  document.getElementById('nim-api-key').value = '';
  refreshNimStatus();
  refreshCodingModels();
}

async function clearNimKey() {
  await window.nexus.clearNimKey();
  refreshNimStatus();
}

async function refreshNimStatus() {
  const has = await window.nexus.hasNimKey();
  document.getElementById('nim-status').innerText = has
    ? 'A key is saved (encrypted on disk). Bug Fix Assist & Feature Suggestions are ready.'
    : 'No key saved yet — Bug Fix Assist & Feature Suggestions need this to work.';
}

// ---------- Backup / move "my Nexus setup" ----------
// Exports/imports the genuinely portable parts of the project list. Secrets
// are deliberately never included - safeStorage encryption is tied to the
// Windows account that created it and cannot be decrypted anywhere else,
// so pretending to back them up would just produce a file that silently
// fails to restore anything useful.
async function exportNexusSetupUI() {
  if (projects.length === 0) { alert('No projects to export yet.'); return; }
  const result = await window.nexus.exportNexusSetup(projects);
  if (result.canceled) return;
  if (!result.ok) { alert('Export failed: ' + result.error); return; }
  showToast('success', `Exported ${result.count} project(s)`, `${result.path}\n\nSecrets were NOT included and need to be re-entered per project after importing this on another machine.`);
}

async function importNexusSetupUI() {
  const result = await window.nexus.importNexusSetup();
  if (result.canceled) return;
  if (!result.ok) { alert('Import failed: ' + result.error); return; }

  const existingFolders = new Set(projects.map((p) => p.folder));
  let added = 0;
  let skipped = 0;
  result.projects.forEach((p, i) => {
    if (existingFolders.has(p.folder)) { skipped++; return; }
    projects.push({
      id: Date.now() + i,
      name: p.name,
      folder: p.folder,
      command: p.command || 'npm run dev',
      port: p.port || '3000',
      running: false,
      deployCommand: p.deployCommand || '',
      services: Array.isArray(p.services) ? p.services : [],
    });
    added++;
  });

  persistProjects();
  renderProjects();

  let details = '';
  if (skipped > 0) details += `Skipped ${skipped} that already exist (same folder path). `;
  if (result.droppedCount > 0) details += `${result.droppedCount} entr${result.droppedCount === 1 ? 'y was' : 'ies were'} malformed and dropped. `;
  details += 'Remember to re-enter secrets for each imported project — they were not included in the export.';
  showToast('success', `Imported ${added} project(s)`, details);
}

async function saveGcpProject() {
  const id = document.getElementById('gcp-project-id').value.trim();
  await window.nexus.saveGcpProject(id);
}

async function askGemini() {
  const prompt = document.getElementById('gemini-prompt').value.trim();
  if (!prompt) return;
  const box = document.getElementById('gemini-response');
  box.innerText = 'Asking Gemini…';
  const result = await window.nexus.geminiAsk(prompt, activeProjectFolder());
  box.innerText = result.ok ? result.text : `Error: ${result.error}`;
}

async function saveOpenaiKey() {
  const key = document.getElementById('openai-api-key').value.trim();
  if (!key) return;
  await window.nexus.saveOpenaiKey(key);
  document.getElementById('openai-api-key').value = '';
  refreshOpenAiStatus();
}

async function clearOpenaiKey() {
  await window.nexus.clearOpenaiKey();
  refreshOpenAiStatus();
}

async function refreshOpenAiStatus() {
  const has = await window.nexus.hasOpenaiKey();
  document.getElementById('openai-status').innerText = has
    ? 'A key is saved (encrypted on disk).'
    : 'No key saved yet.';
}

async function askOpenAi() {
  const prompt = document.getElementById('openai-prompt').value.trim();
  if (!prompt) return;
  const box = document.getElementById('openai-response');
  box.innerText = 'Asking OpenAI…';
  const result = await window.nexus.openaiAsk(prompt, activeProjectFolder());
  box.innerText = result.ok ? result.text : `Error: ${result.error}`;
}

// ---------- AI Code Assist ----------
// autonomousMode lives ONLY in memory — it is never written to localStorage
// or disk, so it is always OFF again the next time the app is launched.
let autonomousMode = false;
let currentAssistFolder = null;
let pendingProposal = null;

function activeProjectFolder() {
  const p = projects.find((x) => x.id === activeProjectId);
  return p ? p.folder : null;
}

async function onTargetChange() {
  const target = document.querySelector('input[name="assist-target"]:checked').value;
  currentAssistFolder = target === 'self' ? await window.nexus.getAppDir() : activeProjectFolder();
  if (target === 'project' && !currentAssistFolder) {
    alert('No active project. Launch one from the Projects tab first, or switch to "Nexus itself".');
  }
  await refreshFileList();
}

async function refreshFileList() {
  if (!currentAssistFolder) {
    const select = document.getElementById('assist-file-select');
    if (select) select.innerHTML = '<option value="">No project selected — see the warning above</option>';
    return;
  }
  const files = await window.nexus.listProjectFiles(currentAssistFolder);
  const select = document.getElementById('assist-file-select');
  select.innerHTML = files.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('')
    || '<option value="">No files found</option>';
}

function onAutonomousToggle() {
  const box = document.getElementById('autonomous-checkbox');
  if (box.checked) {
    const phrase = 'I APPROVE AUTONOMOUS EDITS';
    const typed = prompt(
      `Fully autonomous mode will let Nexus rewrite files WITHOUT showing you a diff first, for the rest of this session only.\n\n` +
      `This applies to Bug Fix Assist AND Feature Builder's "Run Remaining Autonomously" button. Backups are still made, ` +
      `and Feature Builder additionally runs this project's own guardrail tests afterward and auto-reverts every file it touched ` +
      `if they fail - but you will not review changes before they're written.\n\n` +
      `Type exactly: ${phrase}`
    );
    if (typed !== phrase) {
      box.checked = false;
      autonomousMode = false;
      renderFeaturePlan();
      return;
    }
    autonomousMode = true;
  } else {
    autonomousMode = false;
  }
  renderFeaturePlan();
}

async function analyzeBug() {
  if (!currentAssistFolder) await onTargetChange();
  const relFile = document.getElementById('assist-file-select').value;
  if (!relFile) { alert('Pick a file first.'); return; }
  const filePath = currentAssistFolder.replace(/[\\/]+$/, '') + (relFile.startsWith('/') || relFile.includes('\\') ? '' : '/') + relFile;
  const errorText = document.getElementById('assist-error-text').value.trim();

  const result = await window.nexus.aiProposeFix(filePath, errorText, currentAssistFolder);
  if (!result.ok) { alert('Analysis failed: ' + result.error); return; }

  if (autonomousMode) {
    const checkerErrors = (result.checker?.diagnostics || []).filter((item) => item.severity === 'error');
    if (checkerErrors.length) { alert(`Nexus blocked the autonomous fix because the code checker found ${checkerErrors.length} error(s):\n${checkerErrors.map((item) => item.message).join('\n')}`); return; }
    const applied = await window.nexus.applyFileChange(result.filePath, result.newContent, 'AI Bug Fix (autonomous)');
    if (applied.ok) {
      showToast('success', `Autonomously applied a fix to ${relFile}`, `Backup saved at ${applied.backupPath}`);
      recordChangelogEntry(relFile, result.explanation, 'fix');
    } else {
      alert('Failed to write file: ' + applied.error);
    }
    return;
  }

  pendingProposal = result;
  document.getElementById('proposal-card').style.display = 'flex';
  document.getElementById('proposal-file').innerText = relFile;
  document.getElementById('proposal-explanation').innerText = `${result.explanation}${result.checker?.diagnostics?.length ? `\n\nCode checker: ${result.checker.diagnostics.map((item) => `line ${item.line + 1}: ${item.message}`).join(' | ')}` : ''}`;
  document.getElementById('proposal-before').innerText = result.oldContent;
  document.getElementById('proposal-after').innerText = result.newContent;
}

async function approveChange() {
  if (!pendingProposal) return;
  const applied = await window.nexus.applyFileChange(pendingProposal.filePath, pendingProposal.newContent, 'AI Bug Fix Assist');
  if (applied.ok) {
    showToast('success', 'Applied', `Backup saved at ${applied.backupPath}`);
    recordChangelogEntry(document.getElementById('proposal-file').innerText, pendingProposal.explanation, 'fix');
    rejectChange(); // clears the panel
  } else {
    alert('Failed to write file: ' + applied.error);
  }
}

function rejectChange() {
  pendingProposal = null;
  document.getElementById('proposal-card').style.display = 'none';
}

async function analyzeFeatures() {
  const folder = activeProjectFolder();
  if (!folder) { alert('No active project. Launch one from the Projects tab first.'); return; }
  const listEl = document.getElementById('suggestions-list');
  listEl.innerHTML = '<p class="muted small">Analyzing…</p>';

  const result = await window.nexus.aiSuggestFeatures(folder);
  if (!result.ok) { listEl.innerHTML = `<p class="muted small">Error: ${escapeHtml(result.error)}</p>`; return; }

  if (result.suggestions) {
    listEl.innerHTML = result.suggestions.map((s) => `
      <div class="suggestion-item">
        <strong>${escapeHtml(s.title)}</strong>
        <p>${escapeHtml(s.why)}</p>
      </div>
    `).join('');
  } else {
    listEl.innerHTML = `<pre class="response-box" style="margin-top:0;">${escapeHtml(result.raw)}</pre>`;
  }
}

// ---------- Ship: Git, Feature Builder, Deploy ----------
let featurePlan = [];
let featurePendingIndex = null;
let featurePendingProposal = null;
let pendingChangeLog = []; // {file, explanation, kind} — cleared once saved to changelog files

function shipFolder() {
  return activeProjectFolder();
}

async function refreshGitStatus() {
  const folder = shipFolder();
  const p = projects.find((x) => x.id === activeProjectId);
  document.getElementById('ship-active-name').innerText = p ? p.name : 'none';
  if (!folder) {
    document.getElementById('git-branch-display').innerText = 'branch: — (no active project)';
    document.getElementById('git-status-display').innerText = '';
    document.getElementById('git-diff-file-list').innerHTML = '';
    return;
  }
  const [result, workflow, branches, protection] = await Promise.all([
    window.nexus.gitStatus(folder), window.nexus.gitWorkflowStatus(folder),
    window.nexus.gitListBranches(folder), window.nexus.gitBranchProtection(folder),
  ]);
  if (!result.ok) {
    document.getElementById('git-branch-display').innerText = 'branch: —';
    document.getElementById('git-status-display').innerText = result.error;
    document.getElementById('git-diff-file-list').innerHTML = '';
    return;
  }
  document.getElementById('git-branch-display').innerText = `branch: ${result.branch}`;
  document.getElementById('git-status-display').innerText = result.status;
  if (workflow.ok) {
    window._gitWorkflow = workflow;
    document.getElementById('git-sync-indicator').innerText = workflow.upstream ? `↑ ${workflow.ahead}  ↓ ${workflow.behind} vs ${workflow.upstream}` : 'No upstream';
    renderGitWorkflowFiles(workflow);
  }
  if (branches.ok) document.getElementById('git-branch-select').innerHTML = '<option value="">Switch branch…</option>' + branches.branches.map((b) => `<option value="${escapeHtml(b.name)}" ${b.current ? 'disabled' : ''}>${escapeHtml(b.name)}${b.current ? ' (current)' : ''}</option>`).join('');
  const protectionEl = document.getElementById('git-protection-indicator');
  protectionEl.innerText = protection.ok ? (protection.protected ? `protected · ${protection.reviewsRequired || 0} review(s)` : 'not protected') : (protection.authRequired ? 'GitHub login required' : 'protection unavailable');
  await refreshGitDiff(folder);
  await refreshGitStashes();
}

async function showCodeLibrary() {
  document.getElementById('cet-mode-files-btn').classList.remove('active');
  document.getElementById('cet-mode-search-btn').classList.remove('active');
  document.getElementById('cet-mode-library-btn').classList.add('active');
  document.getElementById('code-editor-filetree').style.display = 'none';
  document.getElementById('code-editor-search-panel').style.display = 'none';
  document.getElementById('code-editor-library-panel').style.display = 'flex';
  await searchCodeLibraryUI();
  setTimeout(() => document.getElementById('ce-library-query').focus(), 30);
}

async function searchCodeLibraryUI() {
  if (!codeEditorFolder) return;
  const result = await window.nexus.searchCodeLibrary(codeEditorFolder, {
    query: document.getElementById('ce-library-query').value.trim(),
    language: document.getElementById('ce-library-language').value,
    category: document.getElementById('ce-library-category').value,
    currentFile: codeEditorCurrentRelPath || '',
  });
  if (!result.ok) { document.getElementById('ce-library-summary').innerText = result.error || 'Library unavailable.'; return; }
  const populate = (id, values, label) => {
    const select = document.getElementById(id);
    if (select.options.length === 1) values.forEach((value) => select.add(new Option(value, value)));
  };
  populate('ce-library-language', result.facets.languages);
  populate('ce-library-category', result.facets.categories);
  codeLibraryEntries = result.entries;
  document.getElementById('ce-library-summary').innerText = `${result.entries.length} of ${result.facets.count} patterns`;
  document.getElementById('ce-library-results').innerHTML = result.entries.map((entry, index) => {
    const compatibility = entry.compatible ? '<span class="ce-library-ready">Ready for this project</span>' : `<span class="ce-library-missing">Needs ${escapeHtml(entry.missingDependencies.join(', '))}</span>`;
    return `<div class="ce-library-item" onclick="previewCodeLibraryEntry(${index})"><div class="bold">${escapeHtml(entry.title)}</div><div class="muted small">${escapeHtml(entry.language)} · ${escapeHtml(entry.category)}</div><div class="small" style="margin-top:4px;">${escapeHtml(entry.summary)}</div><div class="small" style="margin-top:5px;">${compatibility}</div></div>`;
  }).join('') || '<p class="muted small" style="padding:8px;">No matching patterns.</p>';
}

function previewCodeLibraryEntry(index) {
  selectedCodeLibraryEntry = codeLibraryEntries[index];
  if (!selectedCodeLibraryEntry) return;
  const entry = selectedCodeLibraryEntry;
  document.getElementById('ce-library-preview-title').innerText = entry.title;
  document.getElementById('ce-library-preview-summary').innerText = entry.summary;
  document.getElementById('ce-library-preview-compatibility').innerText = entry.compatible ? 'Compatible with the detected project.' : `Install first: ${entry.missingDependencies.join(', ')}`;
  document.getElementById('ce-library-preview-usage').innerText = `How to use: ${entry.usage}`;
  document.getElementById('ce-library-preview-code').innerText = entry.code;
  document.getElementById('ce-library-preview-overlay').style.display = 'flex';
}

function closeCodeLibraryPreview() {
  const overlay = document.getElementById('ce-library-preview-overlay');
  if (overlay) overlay.style.display = 'none';
  selectedCodeLibraryEntry = null;
}

function insertCodeLibraryEntry(mode) {
  if (!selectedCodeLibraryEntry || !codeEditorCM || !codeEditorCurrentRelPath) { alert('Open a file before inserting a library pattern.'); return; }
  if (mode === 'selection') {
    if (!codeEditorCM.somethingSelected()) { alert('Select code to replace first.'); return; }
    codeEditorCM.replaceSelection(selectedCodeLibraryEntry.code, 'end', 'code-library');
  } else {
    const cursor = codeEditorCM.getCursor('head');
    codeEditorCM.replaceRange(selectedCodeLibraryEntry.code, cursor, cursor, 'code-library');
  }
  closeCodeLibraryPreview();
  showToast('success', 'Code inserted', 'Review the pattern and save the file when ready.');
}

function renderGitWorkflowFiles(workflow) {
  const el = document.getElementById('git-workflow-file-list');
  el.innerHTML = workflow.files.map((file) => `<div class="form-row small" style="justify-content:space-between; margin-top:4px;"><span class="mono">${escapeHtml(file.status)} ${escapeHtml(file.file)}</span><span>${file.staged ? `<button class="btn btn-secondary" onclick="unstageGitFile('${escapeHtml(file.file).replaceAll("'", '&#39;')}')">Unstage</button>` : `<button class="btn btn-secondary" onclick="stageGitFile('${escapeHtml(file.file).replaceAll("'", '&#39;')}')">Stage</button>`}</span></div>`).join('') || '<p class="muted small">Working tree clean.</p>';
  document.getElementById('git-conflict-list').innerHTML = workflow.conflicts.length ? `<p class="label">Merge conflicts</p>${workflow.conflicts.map((file) => `<button class="btn btn-secondary" onclick="openGitConflict('${escapeHtml(file).replaceAll("'", '&#39;')}')">Resolve ${escapeHtml(file)}</button>`).join(' ')}` : '';
}

async function stageGitFile(file) { await window.nexus.gitStagePaths(shipFolder(), [file]); refreshGitStatus(); }
async function unstageGitFile(file) { await window.nexus.gitUnstagePaths(shipFolder(), [file]); refreshGitStatus(); }
async function stageAllGitFiles() { const files = window._gitWorkflow?.files.filter((f) => !f.staged).map((f) => f.file) || []; if (files.length) await window.nexus.gitStagePaths(shipFolder(), files); refreshGitStatus(); }
async function unstageAllGitFiles() { const files = window._gitWorkflow?.files.filter((f) => f.staged).map((f) => f.file) || []; if (files.length) await window.nexus.gitUnstagePaths(shipFolder(), files); refreshGitStatus(); }
async function switchGitBranch(branch) { if (!branch || !confirm(`Switch to ${branch}?`)) return; const r = await window.nexus.gitSwitchBranch(shipFolder(), branch); if (!r.ok) showToast('error', 'Could not switch branch', r.error || r.output); refreshGitStatus(); }

async function refreshGitStashes() { const folder = shipFolder(); if (!folder) return; const r = await window.nexus.gitListStashes(folder); const el = document.getElementById('git-stash-list'); if (!r.ok) { el.innerHTML = ''; return; } el.innerHTML = r.stashes.map((s) => `<div class="form-row small" style="justify-content:space-between"><span>${escapeHtml(s.ref)} · ${escapeHtml(s.message)}</span><span><button class="btn btn-secondary" onclick="runGitStash('apply','${escapeHtml(s.ref)}')">Apply</button><button class="btn btn-secondary" onclick="runGitStash('pop','${escapeHtml(s.ref)}')">Pop</button><button class="btn btn-secondary" onclick="runGitStash('drop','${escapeHtml(s.ref)}')">Drop</button></span></div>`).join('') || '<p class="muted small">No stashes.</p>'; }
async function createGitStash() { const message = document.getElementById('git-stash-message').value; const r = await window.nexus.gitStashAction(shipFolder(), 'create', null, message); if (!r.ok) showToast('error', 'Stash failed', r.error); refreshGitStatus(); }
async function runGitStash(action, ref) { if (action === 'drop' && !confirm(`Delete ${ref}?`)) return; const r = await window.nexus.gitStashAction(shipFolder(), action, ref); if (!r.ok) showToast('error', 'Stash action failed', r.error); refreshGitStatus(); }

async function openGitConflict(file) { const r = await window.nexus.gitConflictDetails(shipFolder(), file); if (!r.ok) return showToast('error', 'Could not open conflict', r.error); window._gitConflict = r; document.getElementById('git-conflict-file').innerText = file; document.getElementById('git-conflict-content').value = r.current; document.getElementById('git-conflict-editor').style.display = 'block'; }
function useConflictVersion(side) { document.getElementById('git-conflict-content').value = window._gitConflict?.[side] || ''; }
async function saveConflictResolution() { const r = await window.nexus.gitResolveConflict(shipFolder(), window._gitConflict.file, document.getElementById('git-conflict-content').value); if (!r.ok) return showToast('error', 'Resolution failed', r.error); document.getElementById('git-conflict-editor').style.display = 'none'; refreshGitStatus(); }

async function refreshProjectPullRequests() { const el = document.getElementById('github-project-pr-list'); el.innerHTML = '<p class="muted small">Loading…</p>'; const r = await window.nexus.githubProjectPRs(shipFolder(), 'open'); if (!r.ok) { el.innerHTML = `<p class="muted small">${escapeHtml(r.error)}</p>${r.authRequired ? '<button class="btn" onclick="switchTab(\'settings\')">Open GitHub settings</button>' : ''}`; return; } el.innerHTML = r.prs.map((pr) => `<button class="btn btn-secondary" style="margin:3px" onclick="openProjectPullRequest(${pr.number})">#${pr.number} ${escapeHtml(pr.title)} · ${escapeHtml(pr.head)} → ${escapeHtml(pr.base)}</button>`).join('') || '<p class="muted small">No open pull requests.</p>'; }
async function openProjectPullRequest(number) { const el = document.getElementById('github-project-pr-review'); el.innerHTML = '<p class="muted small">Loading review…</p>'; const r = await window.nexus.githubProjectPRReview(shipFolder(), number); if (!r.ok) { el.innerHTML = escapeHtml(r.error); return; } const pr = r.review; window._activeProjectPR = pr; el.innerHTML = `<h3>#${pr.number} ${escapeHtml(pr.title)}</h3><p>${escapeHtml(pr.body || '')}</p><p class="small">Checks: ${pr.checks.map((c) => `${escapeHtml(c.name)}: ${escapeHtml(c.conclusion || c.status)}`).join(' · ') || 'none'}</p>${pr.files.map((f) => `<details><summary>${escapeHtml(f.filename)} (+${f.additions}/-${f.deletions})</summary><pre class="diff-box">${escapeHtml(f.patch)}</pre></details>`).join('')}<textarea id="github-pr-review-body" rows="3" style="width:100%" placeholder="Review comment"></textarea><div class="form-row"><button class="btn" onclick="submitProjectPRReview('APPROVE')">Approve</button><button class="btn btn-secondary" onclick="submitProjectPRReview('REQUEST_CHANGES')">Request changes</button><button class="btn btn-secondary" onclick="submitProjectPRReview('COMMENT')">Comment</button><select id="github-pr-merge-method"><option value="squash">Squash merge</option><option value="merge">Merge commit</option><option value="rebase">Rebase merge</option></select><button class="btn" onclick="mergeProjectPullRequest()">Merge</button></div>`; }
async function submitProjectPRReview(action) { const pr = window._activeProjectPR; const body = document.getElementById('github-pr-review-body').value; const r = await window.nexus.githubProjectPRSubmitReview(shipFolder(), pr.number, body, action); showToast(r.ok ? 'success' : 'error', r.ok ? 'Review submitted' : 'Review failed', r.error || action); if (r.ok) openProjectPullRequest(pr.number); }
async function mergeProjectPullRequest() { const pr = window._activeProjectPR; if (!confirm(`Merge #${pr.number}?`)) return; const method = document.getElementById('github-pr-merge-method').value; const r = await window.nexus.githubProjectPRMerge(shipFolder(), pr.number, method); showToast(r.ok ? 'success' : 'error', r.ok ? 'Pull request merged' : 'Merge failed', r.error || ''); refreshProjectPullRequests(); }

const GD_STATUS_LABELS = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', '??': 'New' };
const GD_STATUS_CLASSES = { M: 'gd-badge-modified', A: 'gd-badge-added', D: 'gd-badge-deleted', R: 'gd-badge-modified', '??': 'gd-badge-added' };
let gdOpenFiles = new Set(); // which diff bodies are currently expanded

async function refreshGitDiff(folder) {
  const listEl = document.getElementById('git-diff-file-list');
  const result = await window.nexus.gitDiff(folder);
  if (!result.ok) { listEl.innerHTML = ''; return; }

  if (result.files.length === 0) {
    listEl.innerHTML = '<p class="muted small">No changes.</p>';
    return;
  }

  listEl.innerHTML = result.files.map((f, i) => {
    const badgeClass = GD_STATUS_CLASSES[f.status] || 'gd-badge-modified';
    const badgeLabel = (f.status || 'M').replace('??', 'N');
    const isOpen = gdOpenFiles.has(f.relPath);
    return `
      <div class="gd-file-row" onclick="toggleGitDiffFile(${i})" title="${escapeHtml(GD_STATUS_LABELS[f.status] || 'Modified')}">
        <span class="gd-file-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
        <span class="gd-file-path">${escapeHtml(f.relPath)}</span>
      </div>
      <div class="gd-diff-body ${isOpen ? 'open' : ''}" id="gd-diff-${i}">
        ${renderGitDiffHunks(f.hunks)}
      </div>
    `;
  }).join('');

  window._gdLastFiles = result.files; // stash for toggle re-render without a re-fetch
}

function renderGitDiffHunks(hunks) {
  return hunks.map((h) => `
    <div class="gd-diff-hunk-header">${escapeHtml(h.header)}</div>
    ${h.lines.map((l) => `<div class="gd-line gd-line-${l.type}">${l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}${escapeHtml(l.text)}</div>`).join('')}
  `).join('') || '<p class="muted small">(binary or unreadable file - no text preview)</p>';
}

function toggleGitDiffFile(index) {
  const relPath = window._gdLastFiles?.[index]?.relPath;
  if (!relPath) return;
  if (gdOpenFiles.has(relPath)) gdOpenFiles.delete(relPath);
  else gdOpenFiles.add(relPath);
  document.getElementById(`gd-diff-${index}`).classList.toggle('open');
}

// ---------- Commit history / branch viewer ----------
let chOpenCommits = new Set(); // which commit diffs are currently expanded

async function refreshCommitHistory() {
  const folder = shipFolder();
  const listEl = document.getElementById('commit-history-list');
  if (!folder) { listEl.innerHTML = '<p class="muted small">No active project.</p>'; return; }

  listEl.innerHTML = '<p class="muted small">Loading…</p>';
  const result = await window.nexus.gitLog(folder, 50);
  if (!result.ok) { listEl.innerHTML = `<p class="muted small">${escapeHtml(result.error)}</p>`; return; }
  if (result.commits.length === 0) { listEl.innerHTML = '<p class="muted small">No commits yet.</p>'; return; }

  window._chLastCommits = result.commits;
  listEl.innerHTML = result.commits.map((c, i) => `
    <div class="ch-commit-row" onclick="toggleCommitDiff(${i}, event)">
      <div class="ch-commit-top">
        <span><span class="ch-hash">${escapeHtml(c.shortHash)}</span> <span class="ch-message">${escapeHtml(c.message)}</span></span>
      </div>
      <div class="ch-meta">${escapeHtml(c.author)} — ${escapeHtml(c.date)}${c.branches.map((b) => `<span class="ch-branch-tag">${escapeHtml(b)}</span>`).join('')} <button class="btn btn-secondary" onclick="runCommitHistoryAction('cherry-pick','${c.hash}',event)">Cherry-pick</button> <button class="btn btn-secondary" onclick="runCommitHistoryAction('revert','${c.hash}',event)">Revert</button></div>
      <div class="gd-diff-body" id="ch-diff-${i}"></div>
    </div>
  `).join('');
}

async function toggleCommitDiff(index, e) {
  e.stopPropagation();
  const commit = window._chLastCommits?.[index];
  if (!commit) return;
  const bodyEl = document.getElementById(`ch-diff-${index}`);

  if (chOpenCommits.has(commit.hash)) {
    chOpenCommits.delete(commit.hash);
    bodyEl.classList.remove('open');
    return;
  }

  chOpenCommits.add(commit.hash);
  bodyEl.classList.add('open');
  if (!bodyEl.dataset.loaded) {
    bodyEl.innerHTML = '<p class="muted small">Loading diff…</p>';
    const folder = shipFolder();
    const result = await window.nexus.gitShowCommit(folder, commit.hash);
    if (!result.ok) { bodyEl.innerHTML = `<p class="muted small">${escapeHtml(result.error)}</p>`; return; }
    bodyEl.innerHTML = result.files.map((f) => `
      <div class="ch-meta" style="margin-top:6px;">📄 ${escapeHtml(f.relPath)}</div>
      ${renderGitDiffHunks(f.hunks)}
    `).join('') || '<p class="muted small">No file changes (merge commit or empty diff).</p>';
    bodyEl.dataset.loaded = 'true';
  }
}

async function createBranch() {
  const folder = shipFolder();
  if (!folder) { alert('No active project.'); return; }
  const name = document.getElementById('git-branch-input').value.trim();
  if (!name) return;
  const result = await window.nexus.gitCreateBranch(folder, name);
  if (!result.ok) alert('Could not create branch: ' + (result.error || result.output));
  document.getElementById('git-branch-input').value = '';
  refreshGitStatus();
}

async function commitAndPush() {
  const folder = shipFolder();
  if (!folder) { alert('No active project.'); return; }

  if (pendingChangeLog.length > 0) {
    const wantsChangelog = confirm(
      `There ${pendingChangeLog.length === 1 ? 'is 1 approved change' : `are ${pendingChangeLog.length} approved changes`} ` +
      `not yet in the changelog.\n\nGenerate a changelog entry first? (You'll review it, then come back and commit.)`
    );
    if (wantsChangelog) {
      await generateChangelog();
      showToast('info', 'Changelog entry generated', 'Review it below, click "Save to Files," then click Commit & Push again when ready.');
      return;
    }
  }

  const message = document.getElementById('git-commit-message').value.trim();
  if (!message) { alert('Write a commit message first.'); return; }
  if (!confirm(`This will commit all changes in ${folder} and push to the remote. Continue?`)) return;

  let commitResult = await window.nexus.gitCommit(folder, message, false);
  if (commitResult.secretScanBlocked) {
    const details = commitResult.findings.map((f) => `${f.file}:${f.line} · ${f.type}`).join('\n');
    if (!confirm(`Commit blocked because potential secrets were detected:\n\n${details}\n\nOnly continue if these are false positives. Commit anyway?`)) return;
    commitResult = await window.nexus.gitCommit(folder, message, true);
  }
  if (!commitResult.ok) { alert('Commit failed: ' + (commitResult.error || commitResult.output)); return; }

  const pushResult = await window.nexus.gitPush(folder);
  if (!pushResult.ok) {
    alert('Committed, but push failed: ' + (pushResult.error || pushResult.output));
  } else {
    showToast('success', 'Committed and pushed');
    document.getElementById('git-commit-message').value = '';
  }
  refreshGitStatus();
}

async function planFeature() {
  const folder = shipFolder();
  if (!folder) { alert('No active project. Launch one from the Projects tab first.'); return; }
  const description = document.getElementById('feature-description').value.trim();
  if (!description) return;

  const listEl = document.getElementById('feature-plan-list');
  listEl.innerHTML = '<p class="muted small">Planning…</p>';

  const result = await window.nexus.aiPlanFeature(folder, description);
  if (!result.ok) { listEl.innerHTML = `<p class="muted small">Error: ${escapeHtml(result.error)}</p>`; return; }

  featurePlan = result.plan.map((item) => ({ ...item, status: 'pending' }));
  renderFeaturePlan();
}

function renderFeaturePlan() {
  const listEl = document.getElementById('feature-plan-list');
  listEl.innerHTML = featurePlan.map((item, i) => `
    <div class="suggestion-item">
      <strong>${escapeHtml(item.file)}</strong> <span class="pill ${item.status === 'done' ? 'on' : ''}">${item.status.toUpperCase()}</span>
      <p>${escapeHtml(item.change)}</p>
      <button class="btn btn-secondary tiny" style="margin-top:6px;" onclick="generateFeatureFile(${i})" ${item.status === 'done' ? 'disabled' : ''}>
        Generate & Review
      </button>
    </div>
  `).join('');

  const autoBtn = document.getElementById('feature-run-autonomous-btn');
  if (autoBtn) {
    const pending = featurePlan.some((item) => item.status !== 'done');
    autoBtn.style.display = autonomousMode && pending ? 'inline-block' : 'none';
  }
}

// Runs every still-pending file in the plan through the SAME autonomous
// opt-in as Bug Fix Assist (autonomousMode - explicit "I APPROVE AUTONOMOUS
// EDITS" phrase, session-only, resets on restart). Unlike the manual
// Generate & Review path, this doesn't stop for a click per file - but it
// still runs the project's own guardrail tests afterward and rolls back
// every file this run touched if they fail, so "autonomous" means
// "written and verified", not "written and hoped".
async function runFeaturePlanAutonomously() {
  if (!autonomousMode) { alert('Turn on "Fully autonomous" first.'); return; }
  const folder = shipFolder();
  if (!folder) { alert('No active project.'); return; }
  const description = document.getElementById('feature-description').value.trim();
  const pending = featurePlan.filter((item) => item.status !== 'done');
  if (pending.length === 0) return;

  if (!confirm(`Run all ${pending.length} remaining file(s) autonomously - no per-file review, but every file will be rolled back automatically if this project's guardrail tests fail afterward. Continue?`)) return;

  const listEl = document.getElementById('feature-plan-list');
  listEl.innerHTML = '<p class="muted small">Running autonomously - generating and applying each file, then verifying with guardrail tests…</p>';

  const result = await window.nexus.runFeaturePlanAutonomous(folder, pending, description);

  if (result.rolledBack) {
    showToast('error', 'Autonomous run rolled back', `Guardrail tests failed after applying ${result.appliedThenRolledBack.length} file(s) - all reverted to their prior content.`);
    renderFeaturePlan();
    return;
  }
  if (!result.ok) {
    showToast('error', 'Autonomous run failed', result.error || 'No files could be applied.');
    renderFeaturePlan();
    return;
  }

  for (const applied of result.appliedFiles) {
    const item = featurePlan.find((p) => p.file === applied.file);
    if (item) item.status = 'done';
    recordChangelogEntry(applied.file, applied.explanation, 'feature');
  }
  if (result.errors && result.errors.length > 0) {
    showToast('info', `${result.appliedFiles.length} file(s) applied, ${result.errors.length} failed to generate`, result.errors.map((e) => e.file).join(', '));
  } else {
    showToast('success', `Autonomously applied and verified ${result.appliedFiles.length} file(s)`, result.guardrailResult.hasGuardrails ? `Guardrails: ${result.guardrailResult.passed}/${result.guardrailResult.total} passed.` : 'No guardrail scripts found for this project.');
  }
  renderFeaturePlan();
}

async function generateFeatureFile(index) {
  const folder = shipFolder();
  const item = featurePlan[index];
  if (!folder || !item) return;
  const filePath = folder.replace(/[\\/]+$/, '') + '/' + item.file;
  const description = document.getElementById('feature-description').value.trim();

  const result = await window.nexus.aiProposeFeatureFile(folder, filePath, description, featurePlan);
  if (!result.ok) { alert('Generation failed: ' + result.error); return; }

  featurePendingIndex = index;
  featurePendingProposal = result;
  document.getElementById('feature-proposal-card').style.display = 'flex';
  document.getElementById('feature-proposal-file').innerText = item.file;
  document.getElementById('feature-proposal-explanation').innerText = result.explanation;
  document.getElementById('feature-proposal-before').innerText = result.oldContent || '(new file)';
  document.getElementById('feature-proposal-after').innerText = result.newContent;
}

async function approveFeatureChange() {
  if (!featurePendingProposal) return;
  const applied = await window.nexus.applyFileChange(featurePendingProposal.filePath, featurePendingProposal.newContent, 'AI Feature Builder');
  if (!applied.ok) { alert('Failed to write file: ' + applied.error); return; }
  featurePlan[featurePendingIndex].status = 'done';
  recordChangelogEntry(featurePlan[featurePendingIndex].file, featurePendingProposal.explanation, 'feature');
  renderFeaturePlan();
  rejectFeatureChange(); // clears the panel
}

function rejectFeatureChange() {
  featurePendingProposal = null;
  featurePendingIndex = null;
  document.getElementById('feature-proposal-card').style.display = 'none';
}

function recordChangelogEntry(file, explanation, kind) {
  pendingChangeLog.push({ file, explanation, kind });
  updateChangelogCount();
}

function updateChangelogCount() {
  const el = document.getElementById('changelog-pending-count');
  if (el) el.innerText = String(pendingChangeLog.length);
}

async function generateChangelog() {
  if (pendingChangeLog.length === 0) {
    alert('No approved changes recorded yet this session (approve a Bug Fix or Feature Builder change first).');
    return;
  }
  const result = await window.nexus.aiGenerateChangelog(pendingChangeLog);
  if (!result.ok) { alert('Could not generate changelog: ' + result.error); return; }

  document.getElementById('changelog-preview').style.display = 'block';
  document.getElementById('changelog-dev-text').innerText = result.devEntry;
  document.getElementById('changelog-user-text').innerText = result.userEntry;
}

async function saveChangelog() {
  const folder = shipFolder();
  if (!folder) { alert('No active project.'); return; }
  const devEntry = document.getElementById('changelog-dev-text').innerText;
  const userEntry = document.getElementById('changelog-user-text').innerText;

  const result = await window.nexus.appendChangelog(folder, devEntry, userEntry);
  if (!result.ok) { alert('Failed to write changelog files: ' + result.error); return; }

  pendingChangeLog = [];
  updateChangelogCount();
  discardChangelog();
  showToast('success', 'Saved to CHANGELOG.md and release-notes.md');
}

function discardChangelog() {
  document.getElementById('changelog-preview').style.display = 'none';
}

function saveDeployCommand() {
  const p = projects.find((x) => x.id === activeProjectId);
  if (!p) { alert('No active project.'); return; }
  p.deployCommand = document.getElementById('deploy-command').value.trim();
  persistProjects();
}

async function runDeploy() {
  const p = projects.find((x) => x.id === activeProjectId);
  if (!p) { alert('No active project.'); return; }
  const command = document.getElementById('deploy-command').value.trim() || p.deployCommand;
  if (!command) { alert('Enter a deploy command first.'); return; }
  if (!pipelineGatePassed) {
    if (!confirm('The Audit → Repair → Test → Gate pipeline has not passed for this session (or was never run). Deploy anyway?')) return;
  }
  if (!confirm(`Run this on your real project?\n\n${command}`)) return;

  document.getElementById('deploy-log-screen').innerText = '';
  const result = await window.nexus.runDeploy(p.id, p.folder, command);
  if (!result.ok) alert('Could not start deploy: ' + result.error);
}

// ---------- Project Capabilities: real Firebase/Capacitor script discovery
// (fullStackSupport.js) - populates the existing Deploy command box and
// reuses its confirm-then-run-and-stream-output flow rather than adding a
// second execution path. Nexus doesn't run these itself. ----------
// ---------- Languages (GitHub repository "Languages" bar equivalent) ----------
async function refreshLanguageBreakdown() {
  const p = projects.find((x) => x.id === activeProjectId);
  const barEl = document.getElementById('languages-bar');
  const legendEl = document.getElementById('languages-legend');
  const summaryEl = document.getElementById('languages-summary');
  if (!barEl || !legendEl || !summaryEl) return;
  if (!p) { barEl.innerHTML = ''; legendEl.innerHTML = ''; summaryEl.innerText = ''; return; }

  summaryEl.innerText = 'Scanning…';
  const result = await window.nexus.scanLanguages(p.folder);

  if (!result.ok) {
    barEl.innerHTML = '';
    legendEl.innerHTML = '';
    summaryEl.innerText = result.error || 'Scan failed.';
    return;
  }
  if (!result.hasData) {
    barEl.innerHTML = '';
    legendEl.innerHTML = '';
    summaryEl.innerText = result.note || 'No source files found.';
    return;
  }

  summaryEl.innerText = `${result.filesClassified} file${result.filesClassified === 1 ? '' : 's'} · ${formatBytes(result.totalBytes)}`;

  barEl.innerHTML = result.languages.map((l) => `
    <div class="lang-bar-segment" style="width:${l.percent}%; background:${l.color};" title="${escapeHtml(l.name)} ${l.percent}%"></div>
  `).join('');

  legendEl.innerHTML = result.languages.map((l) => `
    <div class="lang-legend-item">
      <span class="lang-legend-dot" style="background:${l.color};"></span>
      <span class="lang-legend-name">${escapeHtml(l.name)}</span>
      <span class="lang-legend-percent">${l.percent}%</span>
    </div>
  `).join('');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function scanProjectCapabilities() {
  const p = projects.find((x) => x.id === activeProjectId);
  if (!p) { alert('No active project.'); return; }

  const summaryEl = document.getElementById('capabilities-summary');
  const commandsEl = document.getElementById('capabilities-commands');
  summaryEl.innerText = 'Scanning…';
  commandsEl.innerHTML = '';

  const result = await window.nexus.scanFullStackConfig(p.folder);
  if (!result.ok) { summaryEl.innerText = result.error || 'Scan failed.'; return; }

  const t = result.projectType;
  const traits = [];
  if (t.isTypeScript) traits.push('TypeScript');
  if (t.isReact) traits.push('React');
  if (t.isVite) traits.push('Vite');
  if (t.hasExpress) traits.push('Express');
  if (t.hasFirebase) traits.push('Firebase');
  if (t.hasCapacitor) traits.push('Capacitor (mobile)');
  summaryEl.innerText = traits.length ? `Detected: ${traits.join(', ')} (${t.type})` : `No recognized stack detected (${t.type}).`;

  const allCommands = [...(result.fullStackCommands || []), ...(result.mobileAndFirebaseCommands || [])];
  if (allCommands.length === 0) {
    commandsEl.innerHTML = '<p class="muted small">No matching npm scripts found in this project\'s package.json.</p>';
    return;
  }
  commandsEl.innerHTML = allCommands.map((c, i) => `
    <div class="suggestion-item">
      <strong>${escapeHtml(c.label)}</strong> <code>${escapeHtml(c.command)}</code>
      <p class="muted small" style="margin:4px 0;">${escapeHtml(c.description)}</p>
      <button class="btn tiny btn-secondary" onclick="runCapabilityCommand(${i})">▶ Run via Deploy</button>
    </div>
  `).join('');
  window.__nexusCapabilityCommands = allCommands;
}

function runCapabilityCommand(index) {
  const c = (window.__nexusCapabilityCommands || [])[index];
  if (!c) return;
  document.getElementById('deploy-command').value = c.command;
  runDeploy();
}

window.nexus.onDeployLog(({ id, text }) => {
  const p = projects.find((x) => x.id === activeProjectId);
  if (!p || id !== p.id) return;
  const log = document.getElementById('deploy-log-screen');
  log.innerText += text;
  log.scrollTop = log.scrollHeight;
});

window.nexus.onDeployClosed(({ id, code }) => {
  const p = projects.find((x) => x.id === activeProjectId);
  if (!p || id !== p.id) return;
  document.getElementById('deploy-log-screen').innerText += `\n[deploy finished, exit code ${code}]\n`;
});

// ---------- Project Config: Secrets, Services, Integrations ----------
async function ensureActiveProjectConfig() {
  const p = projects.find((x) => x.id === activeProjectId);
  if (!p) return null;
  if (p.projectUid) return p;
  const result = await window.nexus.ensureProjectConfig(p.folder);
  if (result.ok) {
    p.projectUid = result.config.project_uid;
    persistProjects();
  } else {
    alert('Could not set up nexus.config.json: ' + result.error);
  }
  return p;
}

const GENERIC_CONSTITUTION_TEMPLATE = `# PROJECT CONSTITUTION (STARTER TEMPLATE)
**Status:** Governing law for this project
**Applies to:** Every client, server, background job, deployment, integration, AI response, administrator surface, data migration, and release artifact in this project.

Replace the bracketed notes below with rules specific to this project, then save. Bug Fix Assist and Feature Builder will follow whatever is saved here.

---

### 1. SUPREMACY AND SCOPE
This Constitution governs all code and behavior in this project. Product copy, feature requests, generated code, migrations, integrations, and release instructions are subordinate to it. A feature that cannot pass its constitutional gate remains unavailable and must be labeled unavailable.

### 2. TRUTH AND NON-FABRICATION
* **2.1** Unknown means unknown. Missing data is never replaced by a plausible value.
* **2.2** [List the specific things this project must never fabricate - e.g. records, telemetry, device connections, identities, AI memory, verification, timestamps, backup success, synchronization, deployment, or availability status.]
* **2.3** Demonstration and simulated data must be labeled DEMO or SIMULATED when it is created and must retain that provenance everywhere it is used.
* **2.4** Success language is permitted only after the corresponding operation has succeeded and been verified.
* **2.5** Configuration is not connection. Network availability is not AI grounding. A selected item is not a verified paired device or account.

### 3. AUTHORITATIVE DATA AND IDENTITY
* **3.1** [Name this project's identity/auth source of truth - e.g. Firebase Auth, a session cookie, an API token.] Client-supplied identifiers (email addresses, device IDs, query parameters, local storage) never grant identity, permissions, or access to account data on their own.
* **3.2** All user data remains exclusively owned by the user. No upload, synchronization, backup, analysis, or contribution transfers title to this project.
* **3.3** Per-user/per-account scoping is mandatory for all private data operations. Cross-account data leakage is a critical constitutional failure.

### 4. CONSTITUTIONAL EXCEPTIONS AND OVERRIDES
* **4.1 Absurdity Exception:** Strict literal enforcement of any clause that results in demonstrably absurd, self-contradictory, or catastrophic operational lock-out is nullified in that specific instance, provided the override preserves data integrity, non-fabrication, and explicit user consent.
* **4.2 Contextual Override Mechanism:** Authorized administrative operations may bypass a rigid fallback block, provided the override is fully auditable, leaves an unalterable log trail, and is never used to fabricate data or bypass user-ownership protections.
* **4.3 Purpose-Driven Execution:** System actions, UI rendering, and AI workflows should execute to fulfill verified user intent, without mechanical rigidity breaking usable interfaces or blocking legitimate workflows.

### 5. GATE AND FAILURE BEHAVIOR
Every change follows this sequence:
AUDIT -> REPAIR -> TEST -> GATE -> REPORT -> RELEASE
If any gate fails, release stops. The failure remains visible and is not converted into simulated success, fallback data, or optimistic copy.
`;

function loadConstitutionTemplate() {
  if (document.getElementById('constitution-text').value.trim() &&
      !confirm('This will replace the current text in the box (not yet saved). Continue?')) return;
  document.getElementById('constitution-text').value = GENERIC_CONSTITUTION_TEMPLATE;
}

async function renderConfigTab() {
  const p = await ensureActiveProjectConfig();
  document.getElementById('config-active-name').innerText = p ? p.name : 'none';
  document.getElementById('config-uid-display').innerText = p ? `project_uid: ${p.projectUid}` : 'No active project — launch one from the Projects tab first.';
  if (p) await refreshSecretsList(p.projectUid);
  else document.getElementById('secrets-list').innerHTML = '';
  renderServicesList();
  document.getElementById('integrations-list').innerHTML = '';
  await loadConstitution();
}

async function loadConstitution() {
  const p = projects.find((x) => x.id === activeProjectId);
  if (!p) { document.getElementById('constitution-text').value = ''; return; }
  const result = await window.nexus.readConstitution(p.folder);
  document.getElementById('constitution-text').value = result.ok ? result.content : '';
}

async function saveConstitutionUI() {
  const p = projects.find((x) => x.id === activeProjectId);
  if (!p) { alert('No active project.'); return; }
  const content = document.getElementById('constitution-text').value;
  if (!content.trim()) { alert('Nothing to save — the text box is empty.'); return; }
  const result = await window.nexus.saveConstitution(p.folder, content);
  if (!result.ok) { alert('Failed to save: ' + result.error); return; }
  showToast('success', 'Saved CONSTITUTION.md', 'Bug Fix Assist and Feature Builder will now follow it for this project.');
}

async function refreshSecretsList(projectUid) {
  const result = await window.nexus.listProjectSecrets(projectUid);
  const listEl = document.getElementById('secrets-list');
  if (!result.ok || result.keys.length === 0) {
    listEl.innerHTML = '<p class="muted small">No secrets saved for this project yet.</p>';
    return;
  }
  listEl.innerHTML = result.keys.map((record) => `
    <div class="suggestion-item" data-key="${escapeHtml(record.key)}">
      <strong>${escapeHtml(record.key)}</strong> <span class="pill">${escapeHtml(record.provider)}</span>
      <p class="muted small">${record.expiresAt ? `Expires ${escapeHtml(record.expiresAt)}${new Date(record.expiresAt) < new Date(Date.now() + 30 * 86400000) ? ' · ROTATE SOON' : ''}` : 'No expiration set'}${record.rotatedAt ? ` · rotated ${escapeHtml(record.rotatedAt.slice(0, 10))}` : ''}</p>
      <div class="row" style="margin-top:6px;">
        <button class="btn btn-secondary tiny" onclick="revealSecret(this)">Show</button>
        <button class="btn btn-secondary tiny" onclick="publishSecret(this)">Publish to GitHub</button>
        <button class="btn btn-secondary tiny" onclick="deleteSecret(this)">Delete</button>
      </div>
      <p class="mono small secret-value" style="margin-top:4px;"></p>
    </div>
  `).join('');
}

async function saveProjectSecret() {
  const p = await ensureActiveProjectConfig();
  if (!p) { alert('No active project.'); return; }
  const key = document.getElementById('secret-key-name').value.trim();
  const value = document.getElementById('secret-key-value').value;
  if (!key || !value) return;
  const provider = document.getElementById('secret-provider').value;
  const expiresAt = document.getElementById('secret-expires-at').value || null;
  const result = await window.nexus.saveProjectSecret(p.projectUid, key, value, { provider, expiresAt });
  if (!result.ok) { alert('Failed to save: ' + result.error); return; }
  document.getElementById('secret-key-name').value = '';
  document.getElementById('secret-key-value').value = '';
  if (provider !== 'local') { const environment = provider === 'github-environment' ? prompt('GitHub environment name:') : null; const published = await window.nexus.publishProjectSecret(p.folder, p.projectUid, key, environment); if (!published.ok) showToast('error', 'Secret saved locally but GitHub publish failed', published.error); }
  refreshSecretsList(p.projectUid);
}

async function revealSecret(btn) {
  const wrapper = btn.closest('.suggestion-item');
  const key = wrapper.dataset.key;
  const p = projects.find((x) => x.id === activeProjectId);
  const result = await window.nexus.revealProjectSecret(p.projectUid, key);
  wrapper.querySelector('.secret-value').innerText = result.ok ? result.value : `Error: ${result.error}`;
}

async function deleteSecret(btn) {
  const wrapper = btn.closest('.suggestion-item');
  const key = wrapper.dataset.key;
  const p = projects.find((x) => x.id === activeProjectId);
  if (!confirm(`Delete secret "${key}"?`)) return;
  await window.nexus.deleteProjectSecret(p.projectUid, key);
  refreshSecretsList(p.projectUid);
}

async function exportSecretsToEnv() {
  const p = await ensureActiveProjectConfig();
  if (!p) { alert('No active project.'); return; }
  if (!confirm(`Write this project's saved secrets into ${p.folder}/.env ?\n\nAny existing .env will be backed up to .env.bak first.`)) return;
  const result = await window.nexus.exportSecretsToEnv(p.folder, p.projectUid);
  if (!result.ok) { alert('Failed: ' + result.error); return; }
  showToast('success', `Wrote ${result.count} variable(s) to .env`);
}

// Services
async function startServiceUI() {
  const p = await ensureActiveProjectConfig();
  if (!p) { alert('No active project.'); return; }
  const name = document.getElementById('service-name').value.trim();
  const command = document.getElementById('service-command').value.trim();
  const healthCheckUrl = document.getElementById('service-healthcheck').value.trim() || null;
  if (!name || !command) { alert('Give the service a name and a start command.'); return; }

  if (!p.services) p.services = [];
  if (!p.services.find((s) => s.name === name)) {
    p.services.push({ name, command, healthCheckUrl });
    persistProjects();
  }
  renderServicesList();
  document.getElementById('service-name').value = '';
  document.getElementById('service-command').value = '';
  document.getElementById('service-healthcheck').value = '';

  setServiceRowState(name, 'VERIFYING');
  const result = await window.nexus.startService(p.id, name, p.folder, command, healthCheckUrl, p.projectUid);
  if (!result.ok) alert('Failed to start: ' + result.error);
}

async function stopServiceUI(name) {
  const p = projects.find((x) => x.id === activeProjectId);
  if (!p) return;
  await window.nexus.stopService(p.id, name);
  setServiceRowState(name, 'IDLE');
}

function renderServicesList() {
  const p = projects.find((x) => x.id === activeProjectId);
  const list = document.getElementById('services-list');
  const svcs = p?.services || [];
  if (svcs.length === 0) {
    list.innerHTML = '<p class="muted small">No services configured for this project yet.</p>';
    return;
  }
  list.innerHTML = svcs.map((s) => `
    <div class="suggestion-item" data-service="${escapeHtml(s.name)}">
      <div class="row" style="justify-content:space-between; align-items:center;">
        <strong>${escapeHtml(s.name)}</strong>
        <span class="pill service-state-pill">IDLE</span>
      </div>
      <p class="mono small">${escapeHtml(s.command)}</p>
      <p class="muted small service-error"></p>
      <div class="row" style="margin-top:6px;">
        <button class="btn btn-secondary tiny" onclick="stopServiceUI('${escapeHtml(s.name)}')">Stop</button>
      </div>
    </div>
  `).join('');
}

function setServiceRowState(name, state, lastError) {
  const row = document.querySelector(`#services-list [data-service="${CSS.escape(name)}"]`);
  if (!row) return;
  const pill = row.querySelector('.service-state-pill');
  pill.innerText = state;
  pill.className = 'pill service-state-pill' + (state === 'ONLINE' ? ' on' : '');
  const errEl = row.querySelector('.service-error');
  errEl.innerText = lastError ? `Error: ${lastError}` : '';
}

window.nexus.onServiceState(({ key, state, lastError }) => {
  const [pid, name] = key.split(':');
  const p = projects.find((x) => x.id === activeProjectId);
  if (!p || String(p.id) !== pid) return;
  setServiceRowState(name, state, lastError);
});

// Integrations
async function scanIntegrations() {
  const p = projects.find((x) => x.id === activeProjectId);
  if (!p) { alert('No active project.'); return; }
  const listEl = document.getElementById('integrations-list');
  listEl.innerHTML = '<p class="muted small">Scanning…</p>';
  const result = await window.nexus.scanIntegrations(p.folder);
  if (!result.ok) { listEl.innerHTML = `<p class="muted small">Error: ${escapeHtml(result.error)}</p>`; return; }
  if (result.integrations.length === 0) {
    listEl.innerHTML = '<p class="muted small">No known integrations detected (that\'s fine — the detector only knows about common providers).</p>';
    return;
  }
  listEl.innerHTML = result.integrations.map((i) => `
    <div class="suggestion-item">
      <strong>${escapeHtml(i.provider)}</strong>
      <p>${i.evidence.map(escapeHtml).join('<br>')}</p>
    </div>
  `).join('');
}

// ---------- Ship: Audit -> Repair -> Test -> Gate pipeline ----------
let pipelineGatePassed = false;

function renderPipelineStep(name, result) {
  const status = result.skipped ? 'SKIPPED' : result.ok ? 'PASSED' : 'FAILED';
  const body = (result.output || result.error || '').slice(0, 2000);
  return `
    <div class="suggestion-item">
      <strong>${name}</strong> <span class="pill ${result.ok ? 'on' : ''}">${status}</span>
      <pre class="diff-box" style="max-height:100px; margin-top:6px;">${escapeHtml(body)}</pre>
    </div>
  `;
}

// ---------- Per-test results (Jest/Vitest), separate from Pipeline's
// overall pass/fail gate. Only shows real structured data - if the project
// uses a framework we can't parse, this says so plainly rather than
// fabricating a per-test breakdown. ----------
let lastTestResults = [];

async function runDetailedTests() {
  const folder = shipFolder();
  if (!folder) { alert('No active project.'); return; }

  const summaryEl = document.getElementById('test-results-summary');
  const listEl = document.getElementById('test-results-list');
  const labelEl = document.getElementById('test-framework-label');

  const fw = await window.nexus.detectTestFramework(folder);
  labelEl.innerText = fw.framework ? `(${fw.framework})` : '(no Jest/Vitest detected)';
  summaryEl.innerText = 'Running…';
  listEl.innerHTML = '';

  const result = await window.nexus.runTestsDetailed(folder, null, { coverage: document.getElementById('test-coverage-enabled').checked, maxWorkers: Number(document.getElementById('test-max-workers').value) });

  if (result.multiScript) {
    // No Jest/Vitest, but the project has its own real test:* npm scripts
    // (e.g. Smoke Stack's test:chargpt-contract, test:firestore-rules) -
    // real per-script pass/fail, not fabricated per-assertion detail.
    const passed = result.scripts.filter((s) => s.ok).length;
    summaryEl.innerText = `${passed}/${result.scripts.length} test scripts passed (no Jest/Vitest detected - per-script, not per-assertion, detail).`;
    listEl.innerHTML = result.scripts.map((s, i) => `
      <div class="tr-row">
        <span class="tr-icon tr-icon-${s.ok ? 'pass' : 'fail'}">${s.ok ? '✓' : '✕'}</span>
        <span class="tr-name" title="${escapeHtml(s.name)}" onclick="toggleMultiScriptOutput(${i})" style="cursor:pointer;">${escapeHtml(s.name)}</span>
      </div>
      <pre class="diff-box" id="tr-script-${i}" style="display:none; max-height:200px; margin:4px 0 8px;">${escapeHtml(s.output || '')}</pre>
    `).join('');
    lastTestResults = [];
    return;
  }

  if (!result.detailed) {
    summaryEl.innerText = result.error || (result.ok ? 'Tests passed.' : 'Tests failed.');
    listEl.innerHTML = `<pre class="diff-box" style="max-height:200px;">${escapeHtml(result.output || '')}</pre>`;
    lastTestResults = [];
    return;
  }

  lastTestResults = result.tests;
  const passed = result.tests.filter((t) => t.status === 'pass').length;
  const failed = result.tests.filter((t) => t.status === 'fail').length;
  const skipped = result.tests.filter((t) => t.status === 'skip').length;
  summaryEl.innerText = `${passed} passed, ${failed} failed, ${skipped} skipped`;
  if (result.coverage?.ok) document.getElementById('test-coverage-summary').innerHTML = `<p class="label">Coverage</p>${result.coverage.files.map((f) => `<p class="small mono">${escapeHtml(f.file)} · lines ${f.lines}% · statements ${f.statements}% · functions ${f.functions}% · branches ${f.branches}%</p>`).join('')}`;
  if (result.history) renderTestHistory(result.history);

  renderTestResultsList();
}

function renderTestResultsList() {
  const listEl = document.getElementById('test-results-list');
  listEl.innerHTML = lastTestResults.map((t, i) => `
    <div class="tr-row">
      <span class="tr-icon tr-icon-${t.status}">${t.status === 'pass' ? '✓' : t.status === 'fail' ? '✕' : '○'}</span>
      <span class="tr-name" title="${escapeHtml(t.name)}" onclick="${t.failureMessage ? `toggleTestFailureMessage(${i})` : ''}" style="${t.failureMessage ? 'cursor:pointer;' : ''}">${escapeHtml(t.name)}</span>
      <span class="tr-duration">${t.duration ? t.duration + 'ms' : ''}</span>
      ${t.status === 'fail' ? `<button class="btn tiny btn-secondary tr-rerun" onclick="rerunSingleTest(${i}, event)">↻ Rerun</button><button class="btn tiny btn-secondary" onclick="debugSingleTest(${i}, event)">Debug</button>` : ''}
    </div>
    ${t.failureMessage ? `<div class="tr-failure-message" id="tr-fail-${i}">${escapeHtml(t.failureMessage)}</div>` : ''}
  `).join('') || '<p class="muted small">No tests ran.</p>';
}

function toggleTestFailureMessage(index) {
  document.getElementById(`tr-fail-${index}`)?.classList.toggle('open');
}

function toggleMultiScriptOutput(index) {
  const el = document.getElementById(`tr-script-${index}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function rerunSingleTest(index, e) {
  const folder = shipFolder();
  const test = lastTestResults[index];
  if (!folder || !test) return;

  const btn = e.target;
  btn.disabled = true;
  btn.innerText = '⋯';

  const result = await window.nexus.runTestsDetailed(folder, test.name);

  if (!result.detailed || result.tests.length === 0) {
    alert('Could not rerun this specific test - the test runner may not support name filtering the way Nexus expects. Try "Run Tests" again to re-run the full suite.');
    btn.disabled = false;
    btn.innerText = '↻ Rerun';
    return;
  }

  // Find the matching test in the rerun's results and update just that
  // entry in place, leaving the rest of the list as it was.
  const updated = result.tests.find((t) => t.name === test.name) || result.tests[0];
  lastTestResults[index] = updated;
  renderTestResultsList();

  const passed = lastTestResults.filter((t) => t.status === 'pass').length;
  const failed = lastTestResults.filter((t) => t.status === 'fail').length;
  const skipped = lastTestResults.filter((t) => t.status === 'skip').length;
  document.getElementById('test-results-summary').innerText = `${passed} passed, ${failed} failed, ${skipped} skipped`;
}

async function runPipeline() {
  const folder = shipFolder();
  if (!folder) { alert('No active project.'); return; }
  const stepsEl = document.getElementById('pipeline-steps');
  const gatePill = document.getElementById('gate-pill');
  gatePill.innerText = 'GATE: RUNNING';
  gatePill.className = 'pill';
  stepsEl.innerHTML = '<p class="muted small">Running audit…</p>';

  const audit = await window.nexus.runAudit(folder);
  let stepsHtml = renderPipelineStep('Audit', audit);

  let repair = null;
  let repairRan = false;
  if (!audit.ok) {
    const wantsRepair = confirm('Audit found issues. Attempt automatic repair with "npm audit fix"? This will modify dependency files.');
    if (wantsRepair) {
      repair = await window.nexus.runAuditFix(folder);
      repairRan = true;
      stepsHtml += renderPipelineStep('Repair', repair);
    }
  }

  const tests = await window.nexus.runTests(folder);
  stepsHtml += renderPipelineStep('Test', tests);
  stepsEl.innerHTML = stepsHtml;

  // AI guardrail tests are now a real Ship-pipeline stage, not just a
  // manual button in the AI Tools panel - the same npm-script-based guardrail
  // suite (aiGuardrailTester.js) runs automatically here and its pass/fail
  // feeds the gate, same as Audit and Test do. A project with no guardrail
  // scripts is marked SKIPPED (not a fabricated pass) and doesn't block the
  // gate - only a project that HAS guardrails and fails them does.
  const guardrails = await window.nexus.aiFwRunGuardrails(folder);
  const guardrailStep = !guardrails.ok
    ? { ok: false, error: guardrails.error || 'Guardrail run failed.' }
    : guardrails.hasGuardrails === false
      ? { ok: true, skipped: true, output: guardrails.message || 'No guardrail/contract/safety scripts found in package.json.' }
      : {
          ok: guardrails.passed === guardrails.total,
          output: `${guardrails.passed}/${guardrails.total} guardrail scripts passed (score ${guardrails.score}%).\n` +
            guardrails.results.filter((r) => !r.passed).map((r) => `✕ ${r.script}: ${r.error || 'failed'}`).join('\n'),
        };
  stepsHtml += renderPipelineStep('AI Guardrails', guardrailStep);
  stepsEl.innerHTML = stepsHtml;

  const auditGatePassed = audit.ok || (repairRan && repair && repair.ok);
  const guardrailsGatePassed = guardrailStep.skipped || guardrailStep.ok;
  pipelineGatePassed = auditGatePassed && tests.ok && guardrailsGatePassed;

  gatePill.innerText = pipelineGatePassed ? 'GATE: PASSED' : 'GATE: FAILED';
  gatePill.className = 'pill' + (pipelineGatePassed ? ' on' : '');
}

// ---------- Init ----------
// ---------- Auto-sync from GitHub ----------
// Replaces manually downloading files and copying them into
// C:\dev\nexus-app. Checks Nexus's own repo for new commits on the remote
// every 10 minutes (and once at startup); if found, the build badge in the
// header pulses to show it. Clicking it shows exactly what changed (real
// commit messages, not a vague "update available") and asks for
// confirmation before pulling AND restarting - both genuinely disruptive
// actions that deserve a real decision, not a silent background swap.
let pendingSourceUpdate = null;

const GITHUB_AUTO_SYNC_MIN_SECONDS = 30;
const GITHUB_AUTO_SYNC_MAX_SECONDS = 600;
let githubAutoSyncTimer = null;
let githubAutoSyncRunning = false;

function readGitHubAutoSyncSettings() {
  const enabled = localStorage.getItem('nexus_github_auto_sync_enabled') === 'true';
  const requested = Number.parseInt(localStorage.getItem('nexus_github_auto_sync_seconds') || '300', 10);
  const seconds = Math.max(GITHUB_AUTO_SYNC_MIN_SECONDS, Math.min(GITHUB_AUTO_SYNC_MAX_SECONDS, Number.isFinite(requested) ? requested : 300));
  return { enabled, seconds };
}

async function discoverProjectTests() { const r = await window.nexus.discoverTests(shipFolder()); document.getElementById('test-discovery-summary').innerText = `${r.count} test file(s) discovered before execution.`; document.getElementById('test-snapshot-summary').innerHTML = `<p class="label">Snapshots</p>${r.snapshots.map((s) => `<p class="small mono">${escapeHtml(s.file)} · ${s.size} bytes</p>`).join('') || '<p class="muted small">No snapshots.</p>'}${r.snapshots.length ? '<button class="btn btn-secondary" onclick="updateTestSnapshots()">Review complete — update snapshots</button>' : ''}`; renderTestHistory(r.history); }
function renderTestHistory(history) { document.getElementById('test-history-summary').innerHTML = `<p class="label">Duration &amp; flakiness history</p>${history.filter((t) => t.failures || t.averageDuration).sort((a, b) => b.flakiness - a.flakiness).slice(0, 50).map((t) => `<p class="small">${escapeHtml(t.name)} · ${Math.round(t.flakiness * 100)}% failed across ${t.runs} run(s) · avg ${t.averageDuration ?? '—'}ms</p>`).join('') || '<p class="muted small">History builds as tests run.</p>'}`; }
async function startTestWatch() { const r = await window.nexus.testWatchStart(shipFolder()); showToast(r.ok ? 'success' : 'error', r.ok ? 'Test watch running' : 'Watch failed', r.error || `PID ${r.pid}`); }
async function stopTestWatch() { const r = await window.nexus.testWatchStop(shipFolder()); showToast('info', 'Test watch stopped', r.stopped ? 'Watcher terminated.' : 'No watcher was running.'); }
async function updateTestSnapshots() { if (!confirm('Update snapshots using the project test runner? Review the Git diff afterward.')) return; const r = await window.nexus.updateSnapshots(shipFolder(), null); showToast(r.ok ? 'success' : 'error', r.ok ? 'Snapshots updated' : 'Snapshot update failed', r.error || r.stderr || ''); discoverProjectTests(); refreshGitStatus(); }
async function debugSingleTest(index, event) { event.stopPropagation(); const test = lastTestResults[index]; const r = await window.nexus.debugTest(shipFolder(), test.name); if (!r.ok) return showToast('error', 'Test debugger failed', r.error); document.getElementById('debug-script').value = 'Test runner'; activeDebugTarget = r; for (let attempt = 0; attempt < 30; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 100)); const target = await window.nexus.debuggerGetTarget(shipFolder(), r.id); if (target.debugUrl) { await window.nexus.debuggerConnect(shipFolder(), r.id); await refreshDebugger(); showToast('success', 'Failing test paused in debugger', `PID ${r.pid}`); return; } } showToast('error', 'Test debugger failed', 'Inspector did not become ready.'); }

async function publishSecret(btn) { const wrapper = btn.closest('.suggestion-item'); const key = wrapper.dataset.key; const p = projects.find((x) => x.id === activeProjectId); const environment = prompt('GitHub environment name, or leave blank for repository Actions secrets:', '') || null; const r = await window.nexus.publishProjectSecret(p.folder, p.projectUid, key, environment); showToast(r.ok ? 'success' : 'error', r.ok ? 'Secret published' : 'Publish failed', r.error || (environment || 'GitHub Actions')); refreshSecretsList(p.projectUid); }

let activeDebugTarget = null;
let activeDebugSnapshot = null;
let activeDapSession = null;
async function launchDebugger() {
  const folder = shipFolder();
  const script = document.getElementById('debug-script').value.trim();
  const args = document.getElementById('debug-args').value.trim().split(/\s+/).filter(Boolean);
  if (!folder || !script) return showToast('error', 'Debugger', 'Choose an active project and script.');
  try {
    activeDebugTarget = await window.nexus.debuggerLaunchIsolated(folder, script, args);
    document.getElementById('debug-status').innerText = `Starting PID ${activeDebugTarget.pid}…`;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const target = await window.nexus.debuggerGetTarget(folder, activeDebugTarget.id);
      if (target.debugUrl) { await window.nexus.debuggerConnect(folder, activeDebugTarget.id); await refreshDebugger(); return; }
    }
    throw new Error('Inspector did not become ready.');
  } catch (error) { showToast('error', 'Debugger launch failed', error.message); }
}
async function attachDebugger() { try { activeDebugTarget = await window.nexus.debuggerAttachLocal(shipFolder(), Number(document.getElementById('debug-attach-pid').value), document.getElementById('debug-attach-url').value.trim()); await refreshDebugger(); } catch (error) { showToast('error', 'Attach failed', error.message); } }
async function refreshDebugger() { if (!activeDebugTarget) return; try { activeDebugSnapshot = await window.nexus.debuggerSnapshot(shipFolder(), activeDebugTarget.id); document.getElementById('debug-status').innerText = activeDebugSnapshot.paused ? `Paused: ${activeDebugSnapshot.reason}` : `Running · PID ${activeDebugTarget.pid}`; document.getElementById('debug-call-stack').innerHTML = activeDebugSnapshot.callFrames.map((frame, index) => `<button class="btn btn-secondary" onclick="selectDebugFrame(${index})">${escapeHtml(frame.functionName)} · ${escapeHtml(frame.url || '')}:${frame.line}</button>`).join('') || '<p class="muted small">Pause to inspect the call stack.</p>'; document.getElementById('debug-scripts').innerHTML = activeDebugSnapshot.scripts.map((script) => `<p class="small mono">${escapeHtml(script.url)}${script.sourceMapUrl ? ` → map: ${escapeHtml(script.sourceMapUrl)}` : ''}</p>`).join(''); if (activeDebugSnapshot.callFrames[0]) await selectDebugFrame(0); } catch (error) { showToast('error', 'Debugger refresh failed', error.message); } }
async function selectDebugFrame(index) { const frame = activeDebugSnapshot?.callFrames[index]; if (!frame) return; window._activeDebugFrame = frame; const groups = []; for (const scope of frame.scopes) { if (!scope.objectId) continue; const result = await window.nexus.debuggerProperties(shipFolder(), activeDebugTarget.id, scope.objectId); groups.push(`<details open><summary>${escapeHtml(scope.name || scope.type)}</summary>${result.properties.slice(0, 100).map((p) => `<p class="small mono">${escapeHtml(p.name)} = ${escapeHtml(String(p.value ?? p.description ?? p.type ?? ''))}</p>`).join('')}</details>`); } document.getElementById('debug-variables').innerHTML = groups.join(''); }
async function debugControl(action) { if (!activeDebugTarget) return; try { await window.nexus.debuggerControl(shipFolder(), activeDebugTarget.id, action); setTimeout(refreshDebugger, 100); } catch (error) { showToast('error', 'Debugger action failed', error.message); } }
async function setDebugExceptionMode(mode) { if (activeDebugTarget) await window.nexus.debuggerExceptionMode(shipFolder(), activeDebugTarget.id, mode); }
async function addDebugBreakpoint() { if (!activeDebugTarget) return; const r = await window.nexus.debuggerSetBreakpoint(shipFolder(), activeDebugTarget.id, document.getElementById('debug-breakpoint-url').value.trim(), Number(document.getElementById('debug-breakpoint-line').value), 0, document.getElementById('debug-breakpoint-condition').value); showToast('success', 'Breakpoint added', r.breakpointId || 'Pending script load'); }
async function evaluateDebugWatch() { const frame = window._activeDebugFrame; if (!frame) return showToast('info', 'Watch', 'Pause on a breakpoint first.'); try { const r = await window.nexus.debuggerEvaluate(shipFolder(), activeDebugTarget.id, frame.id, document.getElementById('debug-watch-expression').value.trim()); const value = r.result?.value ?? r.result?.description ?? r.exceptionDetails?.text; document.getElementById('debug-variables').insertAdjacentHTML('afterbegin', `<p class="small mono">watch = ${escapeHtml(String(value))}</p>`); } catch (error) { showToast('error', 'Watch failed', error.message); } }
async function stopDebugger() { if (!activeDebugTarget) return; await window.nexus.debuggerStop(shipFolder(), activeDebugTarget.id); activeDebugTarget = null; activeDebugSnapshot = null; document.getElementById('debug-status').innerText = 'No debug session.'; document.getElementById('debug-call-stack').innerHTML = ''; document.getElementById('debug-variables').innerHTML = ''; }
async function launchDebugAdapter() { try { const command = document.getElementById('debug-dap-command').value.trim(); const adapterId = document.getElementById('debug-dap-id').value.trim(); const configuration = JSON.parse(document.getElementById('debug-dap-config').value); activeDapSession = await window.nexus.debuggerDapStart(shipFolder(), command, [], adapterId, configuration); document.getElementById('debug-status').innerText = `Debug adapter running · PID ${activeDapSession.pid}`; const threads = await window.nexus.debuggerDapRequest(activeDapSession.id, 'threads', {}); document.getElementById('debug-call-stack').innerHTML = (threads.threads || []).map((thread) => `<button class="btn btn-secondary" onclick="loadDapThread(${thread.id})">${escapeHtml(thread.name)}</button>`).join(''); } catch (error) { showToast('error', 'Debug adapter failed', error.message); } }
async function loadDapThread(threadId) { const stack = await window.nexus.debuggerDapRequest(activeDapSession.id, 'stackTrace', { threadId }); window._dapFrames = stack.stackFrames || []; document.getElementById('debug-call-stack').innerHTML = window._dapFrames.map((frame, i) => `<button class="btn btn-secondary" onclick="loadDapFrame(${i})">${escapeHtml(frame.name)} · ${escapeHtml(frame.source?.path || '')}:${frame.line}</button>`).join(''); }
async function loadDapFrame(index) { const frame = window._dapFrames[index]; const result = await window.nexus.debuggerDapRequest(activeDapSession.id, 'scopes', { frameId: frame.id }); const groups = []; for (const scope of result.scopes || []) { const vars = await window.nexus.debuggerDapRequest(activeDapSession.id, 'variables', { variablesReference: scope.variablesReference }); groups.push(`<details open><summary>${escapeHtml(scope.name)}</summary>${(vars.variables || []).map((v) => `<p class="small mono">${escapeHtml(v.name)} = ${escapeHtml(v.value)}</p>`).join('')}</details>`); } document.getElementById('debug-variables').innerHTML = groups.join(''); }

let portableConfigMode = 'shared';
async function loadPortableConfig() { const r = await window.nexus.portableConfigInspect(shipFolder()); const el = document.getElementById('portable-config-status'); if (!r.effective) { el.innerHTML = `<p class="muted small">${escapeHtml((r.errors || []).join('\n'))}</p>`; return; } document.getElementById('portable-config-editor').value = JSON.stringify(r.shared && Object.keys(r.shared).length ? r.shared : { schemaVersion: 1, name: projects.find((p) => p.id === activeProjectId)?.name || '', commands: {}, services: {}, deployments: {}, environment: {}, requiredTools: [], setup: [], debug: {}, remote: {} }, null, 2); portableConfigMode = 'shared'; el.innerHTML = `${r.errors.length ? `<p class="small" style="color:var(--danger)">${escapeHtml(r.errors.join('\n'))}</p>` : '<p class="small">Configuration valid.</p>'}<p class="label">Required tools</p>${r.tools.map((tool) => `<p class="small">${tool.available ? '✓' : '✕'} ${escapeHtml(tool.name)}${tool.path ? ` · ${escapeHtml(tool.path)}` : ''}</p>`).join('') || '<p class="muted small">None declared.</p>'}<p class="label">Environment</p>${r.environment.map((env) => `<p class="small">${env.present ? '✓' : env.required ? '✕' : '○'} ${escapeHtml(env.name)}${env.secret ? ' · secret' : ''}</p>`).join('') || '<p class="muted small">None declared.</p>'}<p class="label">Setup</p>${(r.effective.setup || []).map((step, i) => `<button class="btn btn-secondary" onclick="runPortableSetup(${i})">Run ${escapeHtml(step.name || `${step.command} ${(step.args || []).join(' ')}`)}</button>`).join('')}`; }
async function savePortableConfig(local) { try { const config = JSON.parse(document.getElementById('portable-config-editor').value); const r = await window.nexus.portableConfigSave(shipFolder(), config, local); if (!r.ok) return showToast('error', 'Configuration rejected', (r.errors || [r.error]).join('\n')); showToast('success', local ? 'Local override saved' : 'Portable configuration saved', r.path); await loadPortableConfig(); } catch (error) { showToast('error', 'Invalid configuration', error.message); } }
async function runPortableSetup(index) { if (!confirm('Run this declared setup step in the trusted project?')) return; const r = await window.nexus.portableConfigRunSetup(shipFolder(), index); showToast(r.ok ? 'success' : 'error', r.ok ? 'Setup step complete' : 'Setup step failed', r.output || r.error); await loadPortableConfig(); }

let githubOperations = null;
async function loadGitHubOperations() { const el = document.getElementById('github-operations-summary'); el.innerHTML = '<p class="muted small">Loading remote automation…</p>'; const r = await window.nexus.githubOperationsGet(shipFolder()); if (!r.ok) { el.innerHTML = `<p class="muted small">${escapeHtml(r.error)}</p>${r.authRequired ? '<button class="btn" onclick="switchTab(\'settings\')">Open GitHub settings</button>' : ''}`; return; } githubOperations = r; el.innerHTML = `<p class="label">Workflow runs</p>${r.runs.map((run) => `<button class="btn btn-secondary" onclick="openWorkflowRun(${run.id})">${escapeHtml(run.name)} · ${escapeHtml(run.branch || '')} · ${escapeHtml(run.conclusion || run.status)}</button>`).join('') || '<p class="muted small">No runs.</p>'}<p class="label">Environments &amp; deployments</p>${r.environments.map((env) => `<p class="small">${escapeHtml(env.name)}${env.protectedBranches ? ' · protected branches' : ''}${env.waitTimer ? ` · wait ${env.waitTimer} min` : ''}</p>`).join('')}${r.deployments.map((d) => `<div class="form-row small"><span>${escapeHtml(d.environment)} · ${escapeHtml(d.ref)}</span><button class="btn btn-secondary" onclick="rollbackDeployment(${d.id})">Mark inactive / rollback</button></div>`).join('')}<p class="label">Releases</p>${r.releases.map((release) => `<p class="small">${escapeHtml(release.name)} · ${escapeHtml(release.tag)}</p>`).join('') || '<p class="muted small">No releases.</p>'}<p class="label">Security and dependency alerts</p>${r.alerts.map((a) => `<p class="small">${escapeHtml(a.type)} · ${escapeHtml(a.severity || a.state)} · ${escapeHtml(a.description)}</p>`).join('') || '<p class="muted small">No visible open alerts (token permissions may limit this view).</p>'}`; }
async function openWorkflowRun(runId) { const el = document.getElementById('github-run-details'); el.innerHTML = '<p class="muted small">Loading jobs…</p>'; const r = await window.nexus.githubOperationsRun(shipFolder(), runId); if (!r.ok) { el.innerHTML = escapeHtml(r.error); return; } el.innerHTML = `<p class="label">${escapeHtml(r.run.name)} · ${escapeHtml(r.run.conclusion || r.run.status)}</p><div class="form-row"><button class="btn btn-secondary" onclick="rerunWorkflow(${runId},false)">Rerun all</button><button class="btn btn-secondary" onclick="rerunWorkflow(${runId},true)">Rerun failed</button></div>${r.jobs.map((job) => `<details><summary>${escapeHtml(job.name)} · ${escapeHtml(job.conclusion || job.status)}</summary>${job.steps.map((step) => `<p class="small">${escapeHtml(step.name)} · ${escapeHtml(step.conclusion || step.status)}</p>`).join('')}<button class="btn btn-secondary" onclick="downloadGithubArchive('/repos/${githubOperations.coordinates.owner}/${githubOperations.coordinates.repo}/actions/jobs/${job.id}/logs','${escapeHtml(job.name)}-logs')">Download logs</button></details>`).join('')}<p class="label">Artifacts</p>${r.artifacts.map((artifact) => `<button class="btn btn-secondary" ${artifact.expired ? 'disabled' : ''} onclick="downloadGithubArchive('${escapeHtml(artifact.downloadUrl)}','${escapeHtml(artifact.name)}')">Download ${escapeHtml(artifact.name)} · ${Math.round(artifact.size / 1024)} KB</button>`).join('') || '<p class="muted small">No artifacts.</p>'}`; }
async function rerunWorkflow(runId, failedOnly) { const r = await window.nexus.githubOperationsAction(shipFolder(), 'rerun', { runId, failedOnly }); showToast(r.ok ? 'success' : 'error', r.ok ? 'Workflow queued' : 'Could not rerun workflow', r.error || ''); }
async function rollbackDeployment(deploymentId) { if (!confirm('Mark this deployment inactive? Your deployment platform can use this signal to roll back.')) return; const r = await window.nexus.githubOperationsAction(shipFolder(), 'rollback', { deploymentId }); showToast(r.ok ? 'success' : 'error', r.ok ? 'Deployment marked inactive' : 'Rollback action failed', r.error || ''); loadGitHubOperations(); }
async function downloadGithubArchive(url, name) { const r = await window.nexus.githubOperationsDownload(shipFolder(), url, name); showToast(r.ok ? 'success' : 'error', r.ok ? 'Download saved' : 'Download failed', r.path || r.error); }
async function showCreateRelease() { const tag = prompt('Release tag (for example v1.2.0):'); if (!tag) return; const name = prompt('Release name:', tag) || tag; const target = prompt('Target branch or commit:', 'main') || 'main'; const body = prompt('Release notes (leave blank for generated GitHub notes):', '') || ''; const r = await window.nexus.githubOperationsAction(shipFolder(), 'release', { tag, name, target, body }); showToast(r.ok ? 'success' : 'error', r.ok ? 'Release created' : 'Release failed', r.error || tag); loadGitHubOperations(); }

async function runCommitHistoryAction(action, hash, event) { event.stopPropagation(); if (!confirm(`${action} ${hash.slice(0, 8)}?`)) return; const r = await window.nexus.gitHistoryAction(shipFolder(), action, hash); showToast(r.ok ? 'success' : 'error', r.ok ? `${action} complete` : `${action} failed`, r.error || r.output || ''); refreshGitStatus(); refreshCommitHistory(); }

function currentLanguagePayload(action) {
  const entry = codeEditorOpenFiles.find((file) => file.relPath === codeEditorCurrentRelPath);
  if (!entry || !codeEditorCM) return null;
  const cursor = codeEditorCM.getCursor();
  return { folder: codeEditorFolder, filePath: entry.absPath, content: codeEditorCM.getValue(), line: cursor.line, column: cursor.ch, action };
}

async function editorLanguageAction(action, options = {}) {
  const payload = currentLanguagePayload(action);
  if (!payload) { if (!options.quiet) showToast('info', 'Language intelligence', 'Open a code file first.'); return; }
  if (action === 'rename') {
    const newName = prompt('Rename this symbol to:');
    if (!newName) return;
    payload.newName = newName.trim();
  }
  const result = await window.nexus.languageIntelligence(payload);
  if (!result.ok) { if (!options.quiet) showToast('error', 'Language intelligence failed', result.error); return; }

  if (action === 'complete') {
    const items = result.items || [];
    if (!items.length) { showToast('info', 'Completions', 'No completion is available here.'); return; }
    const choice = prompt(`Choose a completion number:\n\n${items.slice(0, 20).map((item, index) => `${index + 1}. ${item.name}${item.source ? ` — auto-import from ${item.source}` : ''}`).join('\n')}`);
    const selected = items[Number.parseInt(choice, 10) - 1];
    if (selected) {
      const originalOffset = codeEditorCM.indexFromPos(codeEditorCM.getCursor());
      let updated = codeEditorCM.getValue();
      let deltaBeforeCursor = 0;
      for (const edit of (selected.importEdits || []).sort((a, b) => b.start - a.start)) {
        updated = updated.slice(0, edit.start) + edit.newText + updated.slice(edit.start + edit.length);
        if (edit.start <= originalOffset) deltaBeforeCursor += edit.newText.length - edit.length;
      }
      if (selected.importEdits?.length) {
        codeEditorCM.setValue(updated);
        codeEditorCM.setCursor(codeEditorCM.posFromIndex(originalOffset + deltaBeforeCursor));
      }
      codeEditorCM.replaceSelection(selected.name, 'end');
    }
    return;
  }
  if (action === 'definition') {
    const target = result.locations?.[0];
    if (!target) { showToast('info', 'Definition', 'No definition found.'); return; }
    await openFileInEditor(target.file);
    codeEditorCM.setCursor({ line: target.line, ch: target.column });
    codeEditorCM.focus();
    return;
  }
  if (action === 'hover') {
    const hover = result.hover;
    showToast('info', hover?.signature || 'No symbol information', hover?.documentation || '');
    return;
  }
  if (action === 'diagnostics') {
    const diagnostics = result.diagnostics || [];
    renderLintResults(diagnostics.map((item) => ({ ...item, line: item.line + 1, ruleId: `${item.source || result.checker || 'checker'}:${item.code}` })));
    const summary = document.getElementById('ce-lint-summary');
    if (summary) summary.innerText = `${result.language || 'Code'} · ${result.checker || 'no adapter'} · ${diagnostics.length} problem(s)${result.available === false ? ' · full checker unavailable' : ''}`;
    if (!options.quiet && result.available === false) showToast('info', 'Limited code checking', result.restricted ? 'Trust this workspace to allow its installed compiler or linter.' : (result.install || 'No full checker is installed for this language.'));
    return;
  }
  if (action === 'references') {
    renderLanguageLocations('References', result.locations || []);
    return;
  }
  if (action === 'symbols') {
    renderLanguageLocations('Outline', (result.symbols || []).map((item) => ({ ...item, label: `${'  '.repeat(item.depth)}${item.name} · ${item.kind}` })));
    return;
  }
  if (action === 'rename') {
    const files = result.files || [];
    const edits = files.reduce((sum, file) => sum + file.edits, 0);
    if (!files.length || !confirm(`Apply ${edits} rename edit(s) across ${files.length} file(s)?`)) return;
    for (const file of files) {
      const applied = await window.nexus.applyFileChange(file.filePath, file.content, 'Language service rename');
      if (!applied.ok) { showToast('error', 'Rename stopped', `${file.relPath}: ${applied.error}`); return; }
      const open = codeEditorOpenFiles.find((entry) => entry.absPath === file.filePath);
      if (open) { open.content = file.content; open.dirty = false; }
    }
    if (codeEditorCurrentRelPath) await openFileInEditor(codeEditorCurrentRelPath);
    showToast('success', 'Symbol renamed', `${edits} edit(s) applied.`);
  }
}

function renderLanguageLocations(title, locations) {
  const panel = document.getElementById('ce-lint-panel');
  document.getElementById('ce-lint-summary').innerText = `${title}: ${locations.length}`;
  panel.innerHTML = locations.slice(0, 200).map((item) => `
    <div class="ce-lint-item" onclick="openLanguageLocation('${escapeHtml(item.file)}', ${item.line}, ${item.column})">
      <span class="ce-lint-line">${escapeHtml(item.file)}:${item.line + 1}</span>
      <span>${escapeHtml(item.label || title.slice(0, -1))}</span>
    </div>`).join('') || `<p class="muted small">No ${escapeHtml(title.toLowerCase())} found.</p>`;
  panel.classList.add('open');
}

async function openLanguageLocation(relPath, line, column) {
  await openFileInEditor(relPath);
  codeEditorCM.setCursor({ line, ch: column });
  codeEditorCM.focus();
}

async function refreshWorkspaceTrustBadges() {
  for (const project of projects) {
    const trust = await window.nexus.getWorkspaceTrust(project.folder);
    const badge = document.getElementById(`project-trust-${project.id}`);
    if (!badge) continue;
    badge.innerText = trust.trusted ? `TRUSTED · ${trust.permissions.length} permissions` : 'RESTRICTED';
    badge.classList.toggle('on', Boolean(trust.trusted));
    badge.title = trust.trusted ? trust.permissions.join(', ') : 'No project commands may run.';
  }
}

async function configureWorkspaceTrust(id, event) {
  event.stopPropagation();
  const project = projects.find((item) => item.id === id);
  if (!project) return;
  if (!confirm(`Trust ${project.name}?\n\nThis project may contain untrusted code. Choose OK only after reviewing it. Nexus will ask which capabilities to allow next.`)) return;
  const choices = [
    ['checker', 'Allow read-only code, dependency, compiler, and linter checks without granting general command access?'],
    ['commands', 'Run project commands, services, tests, and tools?'],
    ['dependencies', 'Install, remove, or update dependencies?'],
    ['git-write', 'Commit and push changes to GitHub?'],
    ['deploy', 'Run deployment commands?'],
    ['secrets', 'Expose configured project secrets to approved processes?'],
  ];
  const permissions = choices.filter(([, question]) => confirm(`${project.name}: ${question}`)).map(([permission]) => permission);
  const result = await window.nexus.setWorkspaceTrust(project.folder, permissions);
  if (!result.ok) showToast('error', 'Could not save Workspace Trust', result.error);
  else showToast('success', 'Workspace Trust updated', permissions.length ? permissions.join(', ') : 'Restricted mode remains active.');
  refreshWorkspaceTrustBadges();
}

async function revokeWorkspaceTrust(id, event) {
  event.stopPropagation();
  const project = projects.find((item) => item.id === id);
  if (!project || !confirm(`Revoke all execution permissions for ${project.name}?`)) return;
  await window.nexus.revokeWorkspaceTrust(project.folder);
  showToast('info', 'Workspace Trust revoked', `${project.name} is now restricted.`);
  refreshWorkspaceTrustBadges();
}

async function saveAllDirtyEditorFiles(source = 'Automatic save') {
  const current = codeEditorOpenFiles.find((file) => file.relPath === codeEditorCurrentRelPath);
  if (current && codeEditorCM) current.content = codeEditorCM.getValue();

  const failures = [];
  let saved = 0;
  for (const entry of codeEditorOpenFiles.filter((file) => file.dirty)) {
    const result = await window.nexus.applyFileChange(entry.absPath, entry.content, source);
    if (!result.ok) failures.push(`${entry.relPath}: ${result.error}`);
    else {
      entry.dirty = false;
      saved += 1;
    }
  }
  renderCodeEditorTabs();
  return failures.length ? { ok: false, failures } : { ok: true, saved };
}

window.nexus.onExitSaveRequest(async ({ requestId }) => {
  try {
    const result = await saveAllDirtyEditorFiles('Automatic save before Nexus closes');
    window.nexus.completeExitSave(requestId, result);
  } catch (error) {
    window.nexus.completeExitSave(requestId, { ok: false, failures: [error.message] });
  }
});

function renderGitHubAutoSyncSettings() {
  const settings = readGitHubAutoSyncSettings();
  const intervalInput = document.getElementById('github-auto-sync-seconds');
  intervalInput.min = String(GITHUB_AUTO_SYNC_MIN_SECONDS);
  intervalInput.max = String(GITHUB_AUTO_SYNC_MAX_SECONDS);
  document.getElementById('github-auto-sync-enabled').checked = settings.enabled;
  intervalInput.value = String(settings.seconds);
  document.getElementById('github-auto-sync-status').innerText = settings.enabled
    ? `Auto Save/Push runs every ${settings.seconds} seconds.`
    : 'Auto Save/Push is off.';
}

function scheduleGitHubAutoSync() {
  if (githubAutoSyncTimer) clearInterval(githubAutoSyncTimer);
  githubAutoSyncTimer = null;
  const settings = readGitHubAutoSyncSettings();
  if (!settings.enabled) return;
  githubAutoSyncTimer = setInterval(runGitHubAutoSync, settings.seconds * 1000);
}

function saveGitHubAutoSyncSettings() {
  const enabled = document.getElementById('github-auto-sync-enabled').checked;
  const input = document.getElementById('github-auto-sync-seconds');
  const requested = Number.parseInt(input.value || '300', 10);
  const seconds = Math.max(GITHUB_AUTO_SYNC_MIN_SECONDS, Math.min(GITHUB_AUTO_SYNC_MAX_SECONDS, Number.isFinite(requested) ? requested : 300));
  input.value = String(seconds);
  localStorage.setItem('nexus_github_auto_sync_enabled', String(enabled));
  localStorage.setItem('nexus_github_auto_sync_seconds', String(seconds));
  renderGitHubAutoSyncSettings();
  scheduleGitHubAutoSync();
  if (enabled) runGitHubAutoSync();
}

async function runGitHubAutoSync() {
  if (githubAutoSyncRunning) return;
  githubAutoSyncRunning = true;
  const status = document.getElementById('github-auto-sync-status');
  let pushed = 0;
  let failures = 0;
  status.innerText = 'Checking projects for changes…';
  try {
    const saveResult = await saveAllDirtyEditorFiles('Timed Auto Save before GitHub push');
    if (!saveResult.ok) {
      status.innerText = `Auto Save failed: ${saveResult.failures.join('; ')}`;
      showToast('error', 'Auto Save failed', saveResult.failures.join('\n'));
      return;
    }
    for (const project of projects) {
      const result = await window.nexus.gitAutoSync(project.folder, project.name);
      if (result.ok && result.changed) pushed += 1;
      else if (!result.ok && !result.skipped) failures += 1;
    }
    const checkedAt = new Date().toLocaleTimeString();
    status.innerText = failures
      ? `Last checked ${checkedAt}: ${pushed} pushed, ${failures} failed.`
      : `Last checked ${checkedAt}: ${pushed ? `${pushed} project(s) pushed` : 'no changes'}.`;
    if (pushed || saveResult.saved) showToast('success', 'Auto Save/Push complete', `${saveResult.saved} file(s) saved; ${pushed} project(s) pushed.`);
    if (failures) showToast('error', 'Some projects could not auto-sync', `${failures} project(s) need attention in Ship / Git.`);
  } finally {
    githubAutoSyncRunning = false;
  }
}

function renderReleaseUpdateStatus(status) {
  const current = document.getElementById('update-current-version');
  if (!current) return;
  const pill = document.getElementById('update-state-pill');
  const message = document.getElementById('update-message');
  const check = document.getElementById('update-check-btn');
  const download = document.getElementById('update-download-btn');
  const install = document.getElementById('update-install-btn');
  const progress = document.getElementById('update-progress');
  const bar = document.getElementById('update-progress-bar');
  const notes = document.getElementById('update-notes');
  const notesContent = document.getElementById('update-notes-content');
  const labels = {
    idle: 'Ready to check', checking: 'Checking…', available: 'Update available',
    downloading: `Downloading ${status.percent || 0}%`, ready: 'Ready to install',
    'up-to-date': 'Up to date', error: 'Update failed', development: 'Development copy',
  };

  current.innerText = `Installed version ${status.currentVersion || '—'}`;
  pill.innerText = labels[status.state] || 'Updater';
  pill.classList.toggle('on', status.state === 'up-to-date' || status.state === 'ready');
  check.disabled = !status.canCheck || status.state === 'checking' || status.state === 'downloading';
  check.innerText = status.sourceMode || status.state === 'development' ? 'Check source updates' : 'Check for updates';
  download.hidden = status.state !== 'available';
  install.hidden = status.state !== 'ready';
  progress.hidden = status.state !== 'downloading';
  bar.style.width = `${Math.max(0, Math.min(100, status.percent || 0))}%`;

  const releaseNotes = Array.isArray(status.releaseNotes)
    ? status.releaseNotes.map((entry) => entry.note || entry.version || '').filter(Boolean).join('\n\n')
    : String(status.releaseNotes || '').trim();
  notes.hidden = !releaseNotes;
  notesContent.textContent = releaseNotes;

  if (status.state === 'available') message.innerText = `Nexus ${status.availableVersion} is available from GitHub Releases.`;
  else if (status.state === 'ready') message.innerText = `Nexus ${status.availableVersion} has downloaded. Restart when you're ready.`;
  else if (status.state === 'up-to-date') message.innerText = `Nexus ${status.currentVersion} is the latest release.`;
  else if (status.state === 'downloading') message.innerText = 'Downloading the update securely from GitHub Releases…';
  else if (status.state === 'checking') message.innerText = 'Checking GitHub Releases…';
  else message.innerText = status.message || 'Check GitHub Releases for a newer version of Nexus.';
}

async function checkForReleaseUpdate() {
  try {
    const status = await window.nexus.getUpdaterStatus();
    if (status.sourceMode || status.state === 'development') { await checkForUpdatesNow(); return; }
    await window.nexus.checkForUpdates();
  }
  catch (error) { renderReleaseUpdateStatus({ ...(await window.nexus.getUpdaterStatus()), state: 'error', message: error.message }); }
}

async function downloadReleaseUpdate() {
  try { await window.nexus.downloadUpdate(); }
  catch (error) { renderReleaseUpdateStatus({ ...(await window.nexus.getUpdaterStatus()), state: 'error', message: error.message }); }
}

async function installReleaseUpdate() {
  await window.nexus.installUpdateAndRestart();
}

async function checkForUpdatesNow() {
  if (pendingSourceUpdate) {
    promptPullSourceUpdates();
    return;
  }
  const badge = document.getElementById('build-badge');
  const originalText = badge.innerText;
  badge.innerText = 'Checking…';

  const result = await window.nexus.checkForSourceUpdates();

  if (!result.ok) {
    badge.innerText = originalText;
    showToast('error', 'Could not check for updates', result.error);
    return;
  }

  if (!result.hasUpdate) {
    badge.innerText = originalText;
    showToast('success', "You're up to date", 'No new commits on the remote.');
    return;
  }

  pendingSourceUpdate = result;
  badge.innerText = `Build — Update available (${result.behindCount})`;
  badge.classList.add('update-available');
  showToast('info', `${result.behindCount} update(s) available`, 'Click the build badge in the header to review and pull.');
}

async function promptPullSourceUpdates() {
  if (!pendingSourceUpdate) return;
  const messageList = pendingSourceUpdate.commitMessages.slice(0, 10).map((m) => `• ${m}`).join('\n');
  const more = pendingSourceUpdate.commitMessages.length > 10 ? `\n…and ${pendingSourceUpdate.commitMessages.length - 10} more` : '';

  if (!confirm(
    `Pull ${pendingSourceUpdate.behindCount} update(s) and restart Nexus?\n\n${messageList}${more}\n\n` +
    `Nexus will close and reopen automatically once the pull finishes.`
  )) return;

  const badge = document.getElementById('build-badge');
  badge.innerText = 'Pulling…';

  const pullResult = await window.nexus.pullSourceUpdates();
  if (!pullResult.ok) {
    badge.innerText = 'Build — Update available';
    showToast('error', 'Pull failed', pullResult.error);
    return;
  }

  await window.nexus.restartNexus();
  // Nexus restarts here - nothing after this point will run.
}

async function loadBuildInfoAndCheckUpdates() {
  const buildInfo = await window.nexus.getBuildInfo();
  const badge = document.getElementById('build-badge');
  if (buildInfo.ok) {
    badge.innerText = buildInfo.buildNumber ? `Build ${buildInfo.buildNumber}${buildInfo.commitHash ? ` (${buildInfo.commitHash})` : ''}` : `Next build ${buildInfo.nextBuildNumber} — approval required`;
    renderApprovedBuildNumber(buildInfo);
  } else if (buildInfo.version) {
    badge.innerText = `v${buildInfo.version}`;
  } else {
    badge.innerText = '';
  }

  // Silent background check - only surfaces via the badge/toast if there's
  // actually something new, never interrupts if everything's current.
  const result = await window.nexus.checkForSourceUpdates();
  if (result.ok && result.hasUpdate) {
    pendingSourceUpdate = result;
    badge.innerText = `Build — Update available (${result.behindCount})`;
    badge.classList.add('update-available');
    showToast('info', `${result.behindCount} update(s) available`, 'Click the build badge in the header to review and pull.');
  }
}

setInterval(async () => {
  if (pendingSourceUpdate) return; // don't re-check while one's already pending review
  const result = await window.nexus.checkForSourceUpdates();
  if (result.ok && result.hasUpdate) {
    pendingSourceUpdate = result;
    const badge = document.getElementById('build-badge');
    badge.innerText = `Build — Update available (${result.behindCount})`;
    badge.classList.add('update-available');
    showToast('info', `${result.behindCount} update(s) available`, 'Click the build badge in the header to review and pull.');
  }
}, 10 * 60 * 1000);

(async function init() {
  renderProjects();
  updatePrompt();
  refreshGeminiStatus();
  refreshNimStatus();
  refreshGitHubStatus();
  refreshOAuthServices();
  const accountVaultState = await window.nexus.accountVaultStatus();
  if (accountVaultState.autoSyncEnabled) scheduleAccountVaultAutoSync();
  refreshAccountVaultStatus();
  loadOAuthConfiguration();
  loadEmailAccountConfiguration();
  refreshEmailAccountStatus();
  refreshPluginMarketplace();
  refreshLanguageServices();
  loadNexusProfile();
  refreshOpenAiStatus();
  renderGitHubAutoSyncSettings();
  scheduleGitHubAutoSync();
  const gcp = await window.nexus.getGcpProject();
  if (gcp) document.getElementById('gcp-project-id').value = gcp;

  await loadBuildInfoAndCheckUpdates();

  renderReleaseUpdateStatus(await window.nexus.getUpdaterStatus());
  window.nexus.onUpdaterStatus(renderReleaseUpdateStatus);

  updateActivityDot();
})();
let googleDriveFiles = [];

async function loadOAuthConfiguration() {
  const result = await window.nexus.oauthConfiguration();
  if (!result.ok) return;
  document.getElementById('oauth-github-client-id').value = result.githubClientId || '';
  document.getElementById('oauth-google-client-id').value = result.googleClientId || '';
  document.getElementById('oauth-wordpress-client-id').value = result.wordpressClientId || '';
  document.getElementById('oauth-wordpress-redirect-uri').value = result.wordpressRedirectUri || 'http://127.0.0.1:42819/oauth/wordpress/callback';
}

function renderApprovedBuildNumber(buildInfo) {
  const current = document.getElementById('approved-build-current');
  const next = document.getElementById('approved-build-next');
  if (!current || !next) return;
  current.innerText = buildInfo.buildNumber
    ? `Current approved build: ${buildInfo.buildNumber}${buildInfo.approvedAt ? ` · approved ${new Date(buildInfo.approvedAt).toLocaleString()}` : ''}`
    : 'No build number has been approved yet.';
  next.innerText = `Next build awaiting approval: ${buildInfo.nextBuildNumber || '0.0.03'} · 1.0.0 is reserved for public launch.`;
}

async function approveBuildNumber() {
  const preview = await window.nexus.getBuildInfo();
  const next = preview.nextBuildNumber || '0.0.03';
  if (!confirm(`Approve Nexus build ${next}?\n\nThis permanently records the next build number for this Nexus installation. It will not run or publish the installer by itself.`)) return;
  const button = document.getElementById('approve-build-number-btn');
  button.disabled = true;
  try {
    const result = await window.nexus.approveNextBuildNumber();
    renderApprovedBuildNumber(result);
    const badge = document.getElementById('build-badge');
    badge.innerText = `Build ${result.buildNumber}${result.commitHash ? ` (${result.commitHash})` : ''}`;
    showToast('success', `Build ${result.buildNumber} approved`, `Next available build number: ${result.nextBuildNumber}.`);
  } catch (error) { showToast('error', 'Build number was not approved', error.message); }
  finally { button.disabled = false; }
}

async function loadEmailAccountConfiguration() {
  const result = await window.nexus.emailAccountConfiguration();
  if (!result.ok) return;
  document.getElementById('firebase-project-id').value = result.projectId || '';
  document.getElementById('firebase-web-api-key').value = result.apiKey || '';
  document.getElementById('firebase-storage-bucket').value = result.storageBucket || '';
}

async function saveEmailAccountConfiguration() {
  let result;
  try { result = await window.nexus.emailAccountConfigure({ projectId: document.getElementById('firebase-project-id').value.trim(), apiKey: document.getElementById('firebase-web-api-key').value.trim(), storageBucket: document.getElementById('firebase-storage-bucket').value.trim() }); }
  catch (error) { result = { ok: false, error: error.message }; }
  showToast(result.ok ? 'success' : 'error', result.ok ? 'Email account configuration saved' : 'Configuration could not be saved', result.error || 'Firebase email sign-in is ready.');
  refreshEmailAccountStatus();
}

function emailAccountCredentials() {
  return { email: document.getElementById('email-account-email').value.trim(), password: document.getElementById('email-account-password').value };
}

async function signUpEmailAccount() {
  const { email, password } = emailAccountCredentials();
  const result = await window.nexus.emailAccountSignUp(email, password);
  document.getElementById('email-account-password').value = '';
  showToast(result.ok ? 'success' : 'error', result.ok ? 'Nexus account created' : 'Account could not be created', result.error || 'Check your inbox and verify the email address before syncing.');
  refreshEmailAccountStatus(); refreshAccountVaultStatus();
}

async function signInEmailAccount() {
  const { email, password } = emailAccountCredentials();
  const result = await window.nexus.emailAccountSignIn(email, password);
  document.getElementById('email-account-password').value = '';
  showToast(result.ok ? 'success' : 'error', result.ok ? 'Signed in to Nexus' : 'Email sign-in failed', result.error || (result.emailVerified ? 'Email account vault sync is ready.' : 'Verify your email before syncing.'));
  refreshEmailAccountStatus(); refreshAccountVaultStatus();
}

async function signOutEmailAccount() {
  stopAccountVaultAutoSync();
  await window.nexus.emailAccountSignOut();
  document.getElementById('email-account-password').value = '';
  showToast('info', 'Signed out of Nexus account'); refreshEmailAccountStatus(); refreshOAuthServices(); refreshAccountVaultStatus();
}

async function resendEmailVerification() {
  const result = await window.nexus.emailAccountResendVerification();
  showToast(result.ok ? 'success' : 'error', result.ok ? 'Verification email sent' : 'Could not send verification email', result.error || 'Check your inbox and spam folder.');
}

async function resetEmailAccountPassword() {
  const email = document.getElementById('email-account-email').value.trim();
  if (!email) { showToast('error', 'Enter your email address first'); return; }
  const result = await window.nexus.emailAccountResetPassword(email);
  showToast(result.ok ? 'success' : 'error', result.ok ? 'Password reset email sent' : 'Could not send reset email', result.error || 'Check your inbox.');
}

async function refreshEmailAccountStatus() {
  const panel = document.getElementById('email-account-status'); if (!panel) return;
  const result = await window.nexus.emailAccountStatus();
  if (!result.configured) { panel.innerText = 'Email sign-in needs Firebase configuration. Open Account provider configuration below.'; return; }
  if (!result.signedIn) { panel.innerText = 'Not signed in with email.'; return; }
  panel.innerText = `Email sign-in method: ${result.email || 'signed in'} · ${result.emailVerified ? 'verified and ready to sync' : 'verification required before vault sync'}${result.error ? ` · ${result.error}` : ''}`;
  const profileEmail = document.getElementById('nexus-profile-email'); if (profileEmail && result.email) profileEmail.value = result.email;
  if (result.emailVerified) document.getElementById('account-vault-email').checked = true;
}

async function saveOAuthConfiguration() {
  const result = await window.nexus.oauthConfigure({ githubClientId: document.getElementById('oauth-github-client-id').value.trim(), googleClientId: document.getElementById('oauth-google-client-id').value.trim(), googleClientSecret: document.getElementById('oauth-google-client-secret').value.trim(), wordpressClientId:document.getElementById('oauth-wordpress-client-id').value.trim(), wordpressClientSecret:document.getElementById('oauth-wordpress-client-secret').value.trim() });
  if (result.ok) { document.getElementById('oauth-google-client-secret').value = ''; document.getElementById('oauth-wordpress-client-secret').value = ''; }
  showToast(result.ok ? 'success' : 'error', result.ok ? 'OAuth configuration saved' : 'Could not save configuration', result.error || '');
}

async function refreshOAuthServices() {
  const result = await window.nexus.oauthStatus();
  if (!result.ok) return;
  const providers = (result.linkedProviders || []).map((id) => id === 'password' ? 'Email' : id === 'github.com' ? 'GitHub' : id === 'google.com' ? 'Google' : id).join(', ');
  document.getElementById('oauth-service-status').innerText = `Nexus account: ${result.nexusAccount ? `signed in${providers ? ` · sign-in methods: ${providers}` : ''}` : 'not signed in'} · GitHub: ${result.github ? 'connected' : 'not connected'} · Google: ${result.google ? 'connected' : 'not connected'} · WordPress.com: ${result.wordpress ? `linked${result.wordpressProfile?.displayName ? ` as ${result.wordpressProfile.displayName}` : ''}` : 'not linked'}`;
  const profileEmail = document.getElementById('nexus-profile-email'); if (profileEmail) profileEmail.value = result.nexusEmail || '';
  googleConnectionActive = Boolean(result.google);
  wordpressConnectionActive = Boolean(result.wordpress);
  const googleButton = document.getElementById('google-service-btn');
  if (googleButton) {
    googleButton.innerText = googleConnectionActive ? 'Log out of Google' : 'Sign in with Google';
    googleButton.classList.toggle('btn-secondary', googleConnectionActive);
  }
  const wordpressButton = document.getElementById('wordpress-service-btn');
  if (wordpressButton) {
    wordpressButton.innerText = wordpressConnectionActive ? 'Disconnect WordPress.com' : 'Connect WordPress.com';
    wordpressButton.classList.toggle('btn-secondary', wordpressConnectionActive);
  }
  const wordpressSitesButton = document.getElementById('wordpress-sites-btn');
  if (wordpressSitesButton) wordpressSitesButton.hidden = !wordpressConnectionActive;
  const driveActions = document.getElementById('google-drive-actions');
  if (driveActions) driveActions.hidden = !googleConnectionActive;
}

const ACCOUNT_VAULT_PREFERENCE_KEYS = [
  'nexus_workspace_col_fraction', 'nexus_workspace_row_fraction',
  'nexus_github_auto_sync_enabled', 'nexus_github_auto_sync_seconds',
  'nexus_ui_density', 'nexus_reduced_motion', 'nexus_editor_font_size',
  'nexus_editor_tab_size', 'nexus_editor_word_wrap', 'nexus_format_on_save',
];

function nexusPreferenceValue(key, fallback) { return localStorage.getItem(key) ?? fallback; }
function applyNexusPreferences() {
  const density = nexusPreferenceValue('nexus_ui_density', 'comfortable');
  const reduced = nexusPreferenceValue('nexus_reduced_motion', 'false') === 'true';
  const fontSize = Math.min(24, Math.max(11, Number(nexusPreferenceValue('nexus_editor_font_size', '13')) || 13));
  const tabSize = Number(nexusPreferenceValue('nexus_editor_tab_size', '2')) === 4 ? 4 : 2;
  const wrap = nexusPreferenceValue('nexus_editor_word_wrap', 'false') === 'true';
  document.body.classList.toggle('nexus-compact', density === 'compact'); document.body.classList.toggle('nexus-reduced-motion', reduced);
  document.documentElement.style.setProperty('--nexus-editor-font-size', `${fontSize}px`);
  if (codeEditorCM) { codeEditorCM.setOption('tabSize', tabSize); codeEditorCM.setOption('indentUnit', tabSize); codeEditorCM.setOption('lineWrapping', wrap); codeEditorCM.getWrapperElement().style.fontSize = `${fontSize}px`; codeEditorCM.refresh(); }
  const values = { 'nexus-preference-density':density, 'nexus-preference-font-size':String(fontSize), 'nexus-preference-tab-size':String(tabSize) };
  for (const [id, value] of Object.entries(values)) { const element = document.getElementById(id); if (element) element.value = value; }
  for (const [id, key] of [['nexus-preference-word-wrap','nexus_editor_word_wrap'],['nexus-preference-format-save','nexus_format_on_save'],['nexus-preference-reduced-motion','nexus_reduced_motion']]) { const element = document.getElementById(id); if (element) element.checked = nexusPreferenceValue(key, 'false') === 'true'; }
  const editorFormat = document.getElementById('ce-format-on-save'); if (editorFormat) editorFormat.checked = nexusPreferenceValue('nexus_format_on_save', 'false') === 'true';
}

function renderExportProtection(result) {
  const pill = document.getElementById('export-protection-pill');
  const details = document.getElementById('export-protection-result');
  if (!pill || !details) return;
  const errors = result?.checker?.errors?.length || 0;
  const missing = result?.missingReferences?.length || 0;
  const unavailable = result?.checker?.unavailable?.length || 0;
  pill.innerText = result?.ok ? 'EXPORT: VERIFIED' : 'EXPORT: BLOCKED';
  pill.className = `pill ${result?.ok ? 'pill-success' : 'pill-danger'}`;
  details.innerText = result?.ok
    ? `${result.manifest.fileCount} files verified (${formatBytes(result.manifest.totalBytes)}); ${result.checker.recognized} checker-supported text files passed.${unavailable ? ` ${unavailable} optional external checker(s) were unavailable.` : ''}${result.path ? ` Exported to ${result.path}` : ''}`
    : `${result?.error || 'Export failed.'} Checker errors: ${errors}. Missing local references: ${missing}.`;
}

async function preflightProtectedExport() {
  const project = projects.find(item => item.id === activeProjectId);
  if (!project) { alert('No active project.'); return; }
  const pill = document.getElementById('export-protection-pill');
  if (pill) pill.innerText = 'EXPORT: CHECKING…';
  const result = await window.nexus.projectExportPreflight(project.folder);
  renderExportProtection(result);
}

async function runProtectedExport() {
  const project = projects.find(item => item.id === activeProjectId);
  if (!project) { alert('No active project.'); return; }
  const pill = document.getElementById('export-protection-pill');
  if (pill) pill.innerText = 'EXPORT: VERIFYING…';
  const result = await window.nexus.exportProtectedProject(project.folder);
  if (result.canceled) { if (pill) pill.innerText = 'EXPORT: CANCELED'; return; }
  renderExportProtection(result);
  if (result.ok) showToast('success', 'Protected export completed and reverified');
}
function saveNexusPreferences() {
  const pairs = { nexus_ui_density:document.getElementById('nexus-preference-density').value, nexus_editor_font_size:document.getElementById('nexus-preference-font-size').value, nexus_editor_tab_size:document.getElementById('nexus-preference-tab-size').value, nexus_editor_word_wrap:String(document.getElementById('nexus-preference-word-wrap').checked), nexus_format_on_save:String(document.getElementById('nexus-preference-format-save').checked), nexus_reduced_motion:String(document.getElementById('nexus-preference-reduced-motion').checked) };
  for (const [key, value] of Object.entries(pairs)) localStorage.setItem(key, value); applyNexusPreferences();
  document.getElementById('nexus-profile-status').innerText = 'Preferences saved on this computer. Use Sync now to add them to the encrypted account vault.';
}
async function loadNexusProfile() {
  const result = await window.nexus.userProfileGet(); if (!result.ok) return; const profile = result.profile || {};
  for (const [id, key] of [['nexus-profile-display-name','displayName'],['nexus-profile-handle','handle'],['nexus-profile-role','role'],['nexus-profile-bio','bio']]) { const element = document.getElementById(id); if (element) element.value = profile[key] || ''; }
  applyNexusPreferences();
}
async function saveNexusProfile() {
  const profile = { displayName:document.getElementById('nexus-profile-display-name').value, handle:document.getElementById('nexus-profile-handle').value, role:document.getElementById('nexus-profile-role').value, bio:document.getElementById('nexus-profile-bio').value };
  const result = await window.nexus.userProfileSave(profile); document.getElementById('nexus-profile-status').innerText = result.ok ? 'Profile saved. Use Sync now to add it to the encrypted account vault.' : result.error;
  showToast(result.ok ? 'success' : 'error', result.ok ? 'Profile saved' : 'Profile not saved', result.error || 'Your Nexus profile is ready to sync.');
}

function accountVaultPreferences() {
  return Object.fromEntries(ACCOUNT_VAULT_PREFERENCE_KEYS.map((key) => [key, localStorage.getItem(key)]).filter(([, value]) => value !== null));
}

async function accountVaultPlugins() {
  const folder = activeProjectFolder();
  if (!folder) return [];
  try { const plugins = await window.nexus.pluginsList(folder); const links = accountLinkedPluginMap(); return plugins.map((plugin) => ({ ...plugin, ...(links[plugin.id] || {}) })); } catch { return []; }
}

function accountVaultProjects() {
  return projects.filter((project) => project.accountLinked).map((project) => ({ accountLinked:true, accountProjectId:project.accountProjectId, name:project.name, repositoryUrl:project.accountRepositoryUrl, sourceProvider:project.accountSourceProvider, command:project.command, port:project.port, deployCommand:project.deployCommand || '', templateId:project.templateId || null, sandboxed:project.sandboxed === true, linkedAt:project.accountLinkedAt }));
}

let pendingAccountProjects = [];
function queueAccountProjectRestores(items = []) {
  pendingAccountProjects = items.filter((item) => item.accountLinked && item.accountProjectId && item.repositoryUrl && !projects.some((project) => project.accountProjectId === item.accountProjectId));
  const panel = document.getElementById('account-project-list');
  if (!panel) return;
  panel.innerHTML = pendingAccountProjects.map((project, index) => `<div class="suggestion-item"><strong>${escapeHtml(project.name)}</strong><span class="muted small">${escapeHtml(project.repositoryUrl)} · available from your Nexus account</span><button class="btn tiny" onclick="restoreAccountProject(${index})">Restore from GitHub</button></div>`).join('') || '<p class="muted small">No account-linked projects are waiting to be restored on this computer.</p>';
}

async function restoreAccountProject(index) {
  const linked = pendingAccountProjects[index];
  if (!linked) return;
  const panel = document.getElementById('account-project-list');
  panel.innerHTML = '<p class="muted small">Cloning the project through your connected GitHub account…</p>';
  const result = await window.nexus.resolveProjectPath(linked.repositoryUrl);
  if (!result.ok) { queueAccountProjectRestores(pendingAccountProjects); showToast('error', 'Account project could not be restored', result.error); return; }
  projects.push({ id:Date.now(), name:linked.name, folder:result.path, command:linked.command || 'npm run dev', port:linked.port || result.detectedPort?.port || '', deployCommand:linked.deployCommand || '', templateId:linked.templateId || undefined, sandboxed:linked.sandboxed === true, running:false, accountLinked:true, accountProjectId:linked.accountProjectId, accountRepositoryUrl:linked.repositoryUrl, accountSourceProvider:'github', accountLinkedAt:linked.linkedAt || new Date().toISOString() });
  persistProjects(); renderProjects(); queueAccountProjectRestores(pendingAccountProjects);
  showToast('success', 'Account project restored', `${linked.name} was cloned from GitHub. Review Workspace Trust before running it.`);
}

function accountLinkedPluginMap() { try { return JSON.parse(localStorage.getItem('nexus_account_linked_plugins') || '{}'); } catch { return {}; } }
async function linkPluginToAccount(pluginId) {
  const folder = activeProjectFolder(); if (!folder) return;
  try {
    const published = await window.nexus.pluginsMarketplacePublish(folder, pluginId, 'private');
    const links = accountLinkedPluginMap(); links[pluginId] = { accountLinked:true, marketplaceId:published.id, digest:published.digest, packageDigest:published.packageDigest }; localStorage.setItem('nexus_account_linked_plugins', JSON.stringify(links));
    showToast('success', 'Plug-in linked to account', 'Its private signed package reference will be included the next time you sync.'); refreshPluginSecurityList();
  } catch (error) { showToast('error', 'Plug-in could not be linked', error.message); }
}
function unlinkPluginFromAccount(pluginId) { const links = accountLinkedPluginMap(); delete links[pluginId]; localStorage.setItem('nexus_account_linked_plugins', JSON.stringify(links)); showToast('info', 'Plug-in unlinked from account', 'The installed copy remains on this computer.'); refreshPluginSecurityList(); }

async function uploadScreenedPlugin() {
  const folder = activeProjectFolder();
  if (!folder) { showToast('error', 'Open a project first', 'Plug-ins are installed separately for each Nexus project.'); return; }
  const status = document.getElementById('plugin-security-status');
  status.innerText = 'Waiting for a plug-in folder, then screening it without running its code…';
  let result;
  try { result = await window.nexus.pluginsImport(folder); } catch (error) { result = { ok: false, error: error.message }; }
  if (result?.canceled) { status.innerText = 'Upload canceled. Nothing was installed.'; return; }
  if (result?.ok) {
    const report = result.report?.behavior;
    status.innerText = `${result.plugin?.name || result.plugin?.id} passed Defender and behavioral screening (${report?.fileCount || 0} files, risk score ${report?.score || 0}/100). It is installed but disabled until you enable it.`;
    showToast('success', 'Plug-in passed security screening', 'Installed disabled. Review its permissions before enabling it.');
  } else if (result?.blocked) {
    const findings = result.report?.behavior?.findings || [];
    status.innerText = `Upload blocked. Nothing was installed. ${findings.slice(0, 3).map((item) => `${item.file}: ${item.message}`).join(' ') || 'Microsoft Defender did not clear the folder.'}`;
    showToast('error', 'Unsafe plug-in blocked', 'The plug-in was not copied into Nexus.');
  } else {
    status.innerText = `Upload failed. Nothing was installed. ${result?.error || 'Unknown screening error.'}`;
    showToast('error', 'Plug-in upload failed', result?.error || 'Nothing was installed.');
  }
  refreshPluginSecurityList();
}

async function refreshPluginSecurityList() {
  const folder = activeProjectFolder();
  const panel = document.getElementById('plugin-security-list');
  if (!folder) { panel.innerHTML = '<p class="muted small">Open a project to view its plug-ins.</p>'; return; }
  let plugins = [];
  try { plugins = await window.nexus.pluginsScan(folder); } catch (error) { panel.innerHTML = `<p class="muted small">${escapeHtml(error.message)}</p>`; return; }
  const links = accountLinkedPluginMap();
  panel.innerHTML = plugins.map((plugin) => `<div class="suggestion-item"><strong>${escapeHtml(plugin.name || plugin.id)}</strong><span class="muted small">${escapeHtml(plugin.version || '')} · ${plugin.screened ? 'Nexus screened' : plugin.signed ? 'Publisher signed' : 'Not approved'} · ${escapeHtml(plugin.status || '')}${links[plugin.id] ? ' · linked to account' : ''}</span><span class="muted small">Permissions: ${escapeHtml((plugin.capabilities || []).join(', ') || 'none')}</span><div>${plugin.status === 'ACTIVE' ? `<button class="btn tiny btn-secondary" onclick="setPluginEnabled('${escapeHtml(plugin.id)}', false)">Disable</button>` : plugin.status !== 'REJECTED' ? `<button class="btn tiny" onclick="setPluginEnabled('${escapeHtml(plugin.id)}', true)">Enable</button>` : ''}${plugin.status !== 'REJECTED' && plugin.screened ? ` <button class="btn tiny btn-secondary" onclick="publishPluginToMarketplace('${escapeHtml(plugin.id)}')">Publish</button> ${links[plugin.id] ? `<button class="btn tiny btn-secondary" onclick="unlinkPluginFromAccount('${escapeHtml(plugin.id)}')">Unlink from account</button>` : `<button class="btn tiny btn-secondary" onclick="linkPluginToAccount('${escapeHtml(plugin.id)}')">Link to account</button>`}` : ''}</div></div>`).join('') || '<p class="muted small">No plug-ins installed for this project.</p>';
}

let pluginMarketplaceItems = [];
let pendingLinkedPluginRestores = [];
function queueLinkedPluginRestores(plugins = []) { pendingLinkedPluginRestores = plugins.filter((item) => item.accountLinked && item.marketplaceId && item.packageDigest); const button = document.getElementById('restore-linked-plugins-btn'); if (button) button.style.display = pendingLinkedPluginRestores.length ? 'inline-block' : 'none'; }
async function restoreLinkedAccountPlugins() {
  const folder = activeProjectFolder(); if (!folder) { showToast('error', 'Open the destination project first'); return; }
  if (!pendingLinkedPluginRestores.length || !confirm(`Download, verify, and screen ${pendingLinkedPluginRestores.length} account-linked plug-in(s)? They will be installed disabled.`)) return;
  const catalog = await window.nexus.pluginsMarketplaceList(); let installed = 0; const failures = [];
  for (const reference of pendingLinkedPluginRestores) {
    const item = catalog.find((entry) => entry.id === reference.marketplaceId);
    if (!item || item.packageDigest !== reference.packageDigest || (reference.digest && item.digest !== reference.digest)) { failures.push(`${reference.id}: account reference no longer matches the signed package`); continue; }
    try { const result = await window.nexus.pluginsMarketplaceInstall(folder, reference.marketplaceId); if (!result.ok) throw new Error('security screening blocked installation'); installed += 1; } catch (error) { failures.push(`${reference.id}: ${error.message}`); }
  }
  pendingLinkedPluginRestores = failures.length ? pendingLinkedPluginRestores.filter((item) => failures.some((failure) => failure.startsWith(`${item.id}:`))) : []; queueLinkedPluginRestores(pendingLinkedPluginRestores); refreshPluginSecurityList();
  showToast(failures.length ? 'error' : 'success', `${installed} linked plug-in(s) restored`, failures.join(' ') || 'Every package was hash-verified, screened again, and installed disabled.');
}

async function refreshPluginMarketplace() {
  const panel = document.getElementById('plugin-marketplace-list');
  const status = document.getElementById('plugin-marketplace-status');
  if (!panel || !status) return;
  status.innerText = 'Loading public plug-ins and your private plug-ins…';
  try {
    pluginMarketplaceItems = await window.nexus.pluginsMarketplaceList();
    status.innerText = `${pluginMarketplaceItems.length} plug-in${pluginMarketplaceItems.length === 1 ? '' : 's'} available. Public entries work without signing in; private entries require their owner account.`;
    panel.innerHTML = pluginMarketplaceItems.map((plugin, index) => `<div class="suggestion-item"><strong>${escapeHtml(plugin.name || plugin.pluginId)}</strong><span class="muted small">${escapeHtml(plugin.version || '')} · ${plugin.visibility === 'private' ? 'Private to you' : 'Public'} · ${plugin.screened ? 'screened publisher copy' : 'publisher signed'}</span><span class="muted small">${escapeHtml(plugin.description || 'No description provided.')}</span><span class="muted small">Permissions: ${escapeHtml(String(plugin.capabilities || '').split(',').filter(Boolean).join(', ') || 'none')}</span><button class="btn tiny" onclick="installMarketplacePlugin(${index})">Install and screen</button></div>`).join('') || '<p class="muted small">No plug-ins have been published yet.</p>';
  } catch (error) {
    pluginMarketplaceItems = []; panel.innerHTML = '';
    status.innerText = `Plug-in database is unavailable. ${error.message}`;
  }
}

async function publishPluginToMarketplace(pluginId) {
  const folder = activeProjectFolder(); if (!folder) return;
  const visibility = document.getElementById('plugin-marketplace-visibility').value;
  try {
    await window.nexus.pluginsMarketplacePublish(folder, pluginId, visibility);
    showToast('success', visibility === 'public' ? 'Plug-in published for everyone' : 'Private plug-in saved', 'The uploaded package is tied to its screened content hash.');
    refreshPluginMarketplace();
  } catch (error) { showToast('error', 'Plug-in could not be published', error.message); }
}

async function installMarketplacePlugin(index) {
  const folder = activeProjectFolder();
  if (!folder) { showToast('error', 'Open a project first', 'Marketplace plug-ins are installed separately for each project.'); return; }
  const plugin = pluginMarketplaceItems[index]; if (!plugin) return;
  const status = document.getElementById('plugin-marketplace-status');
  status.innerText = `Downloading ${plugin.name || plugin.pluginId}, verifying its contents, and running both security screens…`;
  try {
    const result = await window.nexus.pluginsMarketplaceInstall(folder, plugin.id);
    if (!result.ok) throw new Error(result.blocked ? 'The downloaded plug-in failed security screening and was not installed.' : 'The plug-in could not be installed.');
    status.innerText = `${result.plugin?.name || plugin.name} passed the fresh Defender and behavioral inspection. It is installed but remains disabled.`;
    showToast('success', 'Marketplace plug-in passed screening', 'Review its permissions before enabling it.');
    refreshPluginSecurityList();
  } catch (error) { status.innerText = `Installation blocked. Nothing was activated. ${error.message}`; showToast('error', 'Marketplace installation blocked', error.message); }
}

async function setPluginEnabled(pluginId, enabled) {
  const folder = activeProjectFolder(); if (!folder) return;
  try {
    if (enabled) await window.nexus.pluginsEnable(folder, pluginId); else await window.nexus.pluginsDisable(folder, pluginId);
    showToast('success', enabled ? 'Plug-in enabled' : 'Plug-in disabled', pluginId);
  } catch (error) { showToast('error', 'Plug-in action failed', error.message); }
  refreshPluginSecurityList();
}

async function refreshAccountVaultStatus() {
  const result = await window.nexus.accountVaultStatus();
  const panel = document.getElementById('account-vault-status');
  if (!panel || !result.ok) return;
  const connectionCount = [result.email, result.github, result.google].filter(Boolean).length;
  const linked = connectionCount > 1 ? `${connectionCount} account destinations are connected.` : connectionCount === 1 ? 'One account destination is connected; add another for redundant backup.' : 'Connect an email account, GitHub, or Google before syncing.';
  const schedule = accountVaultAutoSyncTimer ? ' Automatic sync is active every 15 minutes and will resume whenever Nexus reopens.' : '';
  panel.innerText = `${linked}${result.lastSyncedAt ? ` Last synced ${new Date(result.lastSyncedAt).toLocaleString()}.` : ''}${schedule} The passphrase is stored only with Windows encryption and is removed when you sign out.`;
}

const ACCOUNT_VAULT_SYNC_INTERVAL_MS = 15 * 60 * 1000;
let accountVaultAutoSyncTimer = null;
let accountVaultSyncInProgress = false;
let accountProjectSyncInProgress = false;

function stopAccountVaultAutoSync() {
  if (accountVaultAutoSyncTimer) clearInterval(accountVaultAutoSyncTimer);
  accountVaultAutoSyncTimer = null;
}

function scheduleAccountVaultAutoSync() {
  stopAccountVaultAutoSync();
  accountVaultAutoSyncTimer = setInterval(() => runAccountVaultSync(true), ACCOUNT_VAULT_SYNC_INTERVAL_MS);
}

function accountVaultFormValue() {
  return {
    passphrase: document.getElementById('account-vault-passphrase').value,
    providers: { email: document.getElementById('account-vault-email').checked, github: document.getElementById('account-vault-github').checked, google: document.getElementById('account-vault-google').checked },
  };
}

async function runAccountVaultSync(automatic = false) {
  const value = accountVaultFormValue();
  if (!automatic && value.passphrase.length < 12) { showToast('error', 'Choose a longer sync passphrase', 'Use at least 12 characters. It cannot be recovered by Nexus.'); return; }
  if (accountVaultSyncInProgress) return;
  accountVaultSyncInProgress = true;
  document.getElementById('account-vault-status').innerText = automatic ? 'Running the scheduled 15-minute account-vault sync…' : 'Encrypting and syncing the account vault…';
  try {
    if (automatic) await syncAccountLinkedProjects();
    const currentContent = { preferences: accountVaultPreferences(), plugins: await accountVaultPlugins(), projects: accountVaultProjects() };
    const result = automatic ? await window.nexus.accountVaultAutoSync(currentContent) : await window.nexus.accountVaultSync({ ...value, ...currentContent });
    const destinations = Object.entries(result.results || {}).filter(([, state]) => state.ok).map(([name]) => name === 'github' ? 'GitHub' : name === 'google' ? 'Google Drive' : 'Nexus email account').join(', ');
    if (!automatic || !result.ok) showToast(result.ok ? 'success' : 'error', result.ok ? 'Account vault synced' : 'Account vault sync failed', result.ok ? `Encrypted backup saved to ${destinations}. Automatic sync will repeat every 15 minutes until you sign out.` : result.error);
    if (result.ok && !automatic) scheduleAccountVaultAutoSync();
  } catch (error) {
    showToast('error', 'Account vault sync failed', error.message);
  } finally {
    accountVaultSyncInProgress = false;
    document.getElementById('account-vault-passphrase').value = '';
    refreshAccountVaultStatus();
  }
}

async function syncAccountLinkedProjects() {
  if (accountProjectSyncInProgress) return { synced:0, failed:0, skipped:0 };
  accountProjectSyncInProgress = true;
  let synced = 0; let failed = 0; let skipped = 0;
  try {
    const saveResult = await saveAllDirtyEditorFiles('Account project sync before GitHub synchronization');
    if (!saveResult.ok) return { synced, failed:1, skipped, error:saveResult.failures.join('; ') };
    for (const project of projects.filter((item) => item.accountLinked && item.accountRepositoryUrl)) {
      const result = await window.nexus.accountProjectSync(project.folder, project.name, project.accountRepositoryUrl);
      if (result.ok) synced += 1;
      else if (result.skipped) skipped += 1;
      else {
        failed += 1;
        showToast('error', result.conflict ? 'Account project has a Git conflict' : 'Account project sync failed', `${project.name}: ${result.error}`);
      }
    }
    return { synced, failed, skipped };
  } finally { accountProjectSyncInProgress = false; }
}

async function syncAccountVault() {
  await runAccountVaultSync(false);
}

async function restoreAccountVault() {
  const value = accountVaultFormValue();
  if (value.passphrase.length < 12) { showToast('error', 'Enter your sync passphrase', 'Use the same passphrase used when the vault was created.'); return; }
  if (!confirm('Restore API keys and preferences from the newest connected account vault? Existing matching settings on this PC will be replaced.')) return;
  document.getElementById('account-vault-status').innerText = 'Downloading and unlocking the newest account vault…';
  const result = await window.nexus.accountVaultRestore(value);
  if (result.ok) {
    for (const [key, item] of Object.entries(result.preferences || {})) localStorage.setItem(key, item);
    applyNexusPreferences(); await loadNexusProfile();
    queueLinkedPluginRestores(result.plugins || []);
    queueAccountProjectRestores(result.projects || []);
    const missing = (result.plugins || []).filter((plugin) => plugin.enabled).map((plugin) => `${plugin.id}${plugin.version ? `@${plugin.version}` : ''}`);
    renderGitHubAutoSyncSettings(); scheduleGitHubAutoSync();
    showToast('success', 'Account vault restored', `${result.restoredApiKeyCount} API key(s) restored from ${result.source}. ${missing.length ? `${missing.length} enabled plug-in(s) are listed for signed reinstall.` : 'No plug-ins need reinstalling.'}`);
  } else showToast('error', 'Account vault restore failed', result.error);
  document.getElementById('account-vault-passphrase').value = '';
  refreshAccountVaultStatus(); refreshGeminiStatus(); refreshNimStatus(); refreshOpenAiStatus();
}

function applyRestoredVaultResult(result) {
  for (const [key, item] of Object.entries(result.preferences || {})) localStorage.setItem(key, item);
  applyNexusPreferences(); loadNexusProfile();
  queueLinkedPluginRestores(result.plugins || []);
  queueAccountProjectRestores(result.projects || []);
  const missing = (result.plugins || []).filter((plugin) => plugin.enabled).map((plugin) => `${plugin.id}${plugin.version ? `@${plugin.version}` : ''}`);
  renderGitHubAutoSyncSettings(); scheduleGitHubAutoSync();
  refreshGeminiStatus(); refreshNimStatus(); refreshOpenAiStatus();
  return `${result.restoredApiKeyCount} API key(s) restored. ${missing.length ? `${missing.length} enabled plug-in(s) are listed for signed reinstall.` : 'No plug-ins need reinstalling.'}`;
}

async function exportAirGappedVault() {
  const passphrase = document.getElementById('account-vault-passphrase').value;
  if (passphrase.length < 12) { showToast('error', 'Enter a 12+ character vault passphrase', 'The same passphrase is required for restore.'); return; }
  const status = document.getElementById('airgap-vault-status'); status.innerText = 'Creating an encrypted offline vault without contacting cloud services…';
  const result = await window.nexus.accountVaultAirgapExport({ passphrase, preferences: accountVaultPreferences(), plugins: await accountVaultPlugins(), projects: accountVaultProjects() });
  if (result.canceled) { status.innerText = 'Offline export canceled.'; return; }
  if (result.ok) {
    status.innerText = `Encrypted vault exported to ${result.path}. Disconnect the removable drive to complete the air gap.`;
    showToast('success', 'Offline vault exported', 'Disconnect and securely store the removable drive.');
  } else { status.innerText = `Offline export failed: ${result.error}`; showToast('error', 'Offline vault export failed', result.error); }
  document.getElementById('account-vault-passphrase').value = '';
}

async function restoreAirGappedVault() {
  const passphrase = document.getElementById('account-vault-passphrase').value;
  if (passphrase.length < 12) { showToast('error', 'Enter the offline vault passphrase'); return; }
  if (!confirm('Restore API keys and preferences from a local offline vault file? Existing matching settings on this PC will be replaced.')) return;
  const status = document.getElementById('airgap-vault-status'); status.innerText = 'Opening and decrypting the local vault without contacting cloud services…';
  const result = await window.nexus.accountVaultAirgapRestore({ passphrase });
  if (result.canceled) { status.innerText = 'Offline restore canceled.'; return; }
  if (result.ok) {
    const summary = applyRestoredVaultResult(result); status.innerText = `Offline vault restored. ${summary}`; showToast('success', 'Offline vault restored', summary);
  } else { status.innerText = `Offline restore failed: ${result.error}`; showToast('error', 'Offline vault restore failed', result.error); }
  document.getElementById('account-vault-passphrase').value = '';
}

let githubOAuthInProgress = false;
let githubConnectionActive = false;

function setGitHubOAuthWaiting(waiting) {
  githubOAuthInProgress = waiting;
  for (const id of ['github-oauth-connect-btn', 'github-login-btn']) {
    const button = document.getElementById(id);
    if (button) button.disabled = waiting;
  }
}

async function copyGithubDeviceCode() {
  const result = await window.nexus.githubOAuthCopyCode();
  showToast(result.ok ? 'success' : 'error', result.ok ? 'GitHub code copied' : 'Could not copy code', result.error || 'Paste it into the open GitHub page.');
}

async function toggleGitHubConnection() {
  if (githubOAuthInProgress) return;
  if (githubConnectionActive) await githubDisconnect();
  else await connectGitHubOAuth();
}

async function completeGitHubOAuth() {
  const panelStatus = document.getElementById('github-device-status');
  const retry = document.getElementById('github-device-retry');
  retry.hidden = true;
  panelStatus.innerText = 'Waiting for GitHub authorization. You can safely return to Nexus after approving it…';
  const result = await window.nexus.githubOAuthComplete();
  const githubMessage = result.account?.unified ? `GitHub is linked to your Nexus account${result.account.email ? ` (${result.account.email})` : ''}.` : result.account?.error || result.account?.reason || 'Private repositories and GitHub tools are ready.';
  if (result.ok) {
    panelStatus.innerText = 'GitHub connected successfully. No token or command-line setup is required.';
    document.getElementById('github-device-panel').hidden = true;
  } else {
    panelStatus.innerText = result.error;
    retry.hidden = !result.retryable;
  }
  showToast(result.ok ? 'success' : 'error', result.ok ? 'GitHub connected' : 'GitHub sign-in needs attention', result.error || githubMessage);
  setGitHubOAuthWaiting(false);
  refreshOAuthServices(); refreshGitHubStatus(); refreshAccountVaultStatus();
}

async function retryGitHubOAuthCompletion() {
  if (githubOAuthInProgress) return;
  setGitHubOAuthWaiting(true);
  await completeGitHubOAuth();
}

async function connectGitHubOAuth() {
  if (githubOAuthInProgress) return;
  const status = document.getElementById('oauth-service-status');
  setGitHubOAuthWaiting(true);
  const start = await window.nexus.githubOAuthStart();
  if (!start.ok) {
    setGitHubOAuthWaiting(false);
    showToast('error', 'GitHub sign-in could not start', start.error);
    return;
  }
  document.getElementById('github-device-code').innerText = start.userCode;
  document.getElementById('github-device-panel').hidden = false;
  status.innerText = 'GitHub sign-in is open. Nexus copied the one-time code and is waiting for approval.';
  await completeGitHubOAuth();
}

async function connectGoogleOAuth() {
  document.getElementById('oauth-service-status').innerText = 'Complete Google sign-in and Drive permission in your browser…';
  const result = await window.nexus.googleOAuthConnect();
  const googleMessage = result.account?.unified ? `Google is linked to your Nexus account${result.account.email ? ` (${result.account.email})` : ''}.` : result.account?.error || result.account?.reason || 'Google Drive storage is ready.';
  showToast(result.ok ? 'success' : 'error', result.ok ? 'Google connected' : 'Google sign-in failed', result.error || googleMessage);
  refreshOAuthServices();
  refreshAccountVaultStatus();
}

let googleConnectionActive = false;
async function toggleGoogleConnection() {
  if (googleConnectionActive) await disconnectGoogleOAuth();
  else await connectGoogleOAuth();
}

async function disconnectGoogleOAuth() {
  if (!confirm('Disconnect Google and revoke the Nexus session?')) return;
  await window.nexus.googleOAuthDisconnect(); googleDriveFiles = []; document.getElementById('google-drive-files').innerHTML = ''; refreshOAuthServices();
}

async function connectWordPressOAuth() {
  document.getElementById('oauth-service-status').innerText = 'Complete WordPress.com sign-in and permission approval in your browser…';
  const result = await window.nexus.wordpressOAuthConnect();
  showToast(result.ok ? 'success' : 'error', result.ok ? 'WordPress.com connected' : 'WordPress.com sign-in failed', result.error || 'Your WordPress.com sites are ready.');
  await refreshOAuthServices(); if (result.ok) loadWordPressSites();
}

let wordpressConnectionActive = false;
async function toggleWordPressConnection() {
  if (wordpressConnectionActive) await disconnectWordPressOAuth();
  else await connectWordPressOAuth();
}

async function disconnectWordPressOAuth() {
  if (!confirm('Disconnect WordPress.com and remove its encrypted Nexus access token?')) return;
  await window.nexus.wordpressOAuthDisconnect(); document.getElementById('wordpress-sites').innerHTML = ''; refreshOAuthServices();
}
async function loadWordPressSites() {
  const panel = document.getElementById('wordpress-sites'); panel.innerHTML = '<p class="muted small">Loading WordPress.com sites…</p>';
  const result = await window.nexus.wordpressSites();
  if (!result.ok) { panel.innerHTML = `<p class="muted small">${escapeHtml(result.error)}</p>`; return; }
  panel.innerHTML = result.sites.map((site) => `<div class="suggestion-item"><strong>${escapeHtml(site.name)}</strong><span class="muted small">${escapeHtml(site.url)} · ${site.private ? 'private' : 'public'}${site.jetpack ? ' · Jetpack' : ''}</span><span class="muted small">Access: ${escapeHtml(Object.keys(site.capabilities || {}).filter((key) => site.capabilities[key]).join(', ') || 'view only')}</span></div>`).join('') || '<p class="muted small">No WordPress.com or Jetpack-connected sites were returned by this account.</p>';
}

async function uploadGoogleDriveFile() {
  const result = await window.nexus.googleDriveUpload();
  if (!result.canceled) showToast(result.ok ? 'success' : 'error', result.ok ? 'Uploaded to Google Drive' : 'Drive upload failed', result.file?.name || result.error);
  if (result.ok) loadGoogleDriveFiles();
}

async function loadGoogleDriveFiles() {
  const panel = document.getElementById('google-drive-files'); panel.innerHTML = '<p class="muted small">Loading Google Drive files…</p>';
  const result = await window.nexus.googleDriveList();
  if (!result.ok) { panel.innerHTML = `<p class="muted small">${escapeHtml(result.error)}</p>`; return; }
  googleDriveFiles = result.files;
  panel.innerHTML = googleDriveFiles.map((file, index) => `<div class="suggestion-item"><strong>${escapeHtml(file.name)}</strong><span class="muted small">${escapeHtml(file.modifiedTime || '')}</span><button class="btn tiny btn-secondary" onclick="downloadGoogleDriveFile(${index})">Download</button></div>`).join('') || '<p class="muted small">No Nexus-accessible Drive files yet.</p>';
}

async function downloadGoogleDriveFile(index) {
  const file = googleDriveFiles[index]; if (!file) return;
  const result = await window.nexus.googleDriveDownload(file.id, file.name);
  if (!result.canceled) showToast(result.ok ? 'success' : 'error', result.ok ? 'Drive file downloaded' : 'Drive download failed', result.path || result.error);
}

async function githubDisconnect() {
  if (!confirm('Disconnect this GitHub account from Nexus?')) return;
  await window.nexus.clearGitHubToken();
  refreshGitHubStatus();
  refreshOAuthServices();
  showToast('info', 'GitHub disconnected');
}

async function refreshGitHubStatus() {
  const statusEl = document.getElementById('github-status');
  if (!statusEl) return;
  const connected = await window.nexus.hasGitHubToken();
  githubConnectionActive = connected;
  statusEl.innerText = connected ? 'GitHub is connected and ready.' : 'GitHub is not connected. Select Connect GitHub—no token or command line is required.';
  for (const id of ['github-login-btn', 'github-oauth-connect-btn']) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.disabled = false;
    button.innerText = connected ? 'Log out of GitHub' : 'Connect GitHub';
    button.classList.toggle('btn-secondary', connected);
  }
}

// ---------- AI Tools panel ----------
// Thin UI over the AI Improvement Framework's IPC surface (aiFw* in
// preload.js). Every button below calls a real main-process module - see
// aiInventory.js, aiMetrics.js, aiGuardrailTester.js,
// aiUpgradeOrchestrator.js, promptTesting.js, dependencyAuditor.js,
// complianceMonitor.js, changelogGenerator.js, knowledgeBase.js, and
// experimentationFramework.js. Output is just the JSON each call returns,
// pretty-printed - nothing here is synthesized in the renderer.

function toggleAIToolsPanel() {
  const overlay = document.getElementById('aitools-overlay');
  const isOpen = overlay.classList.contains('open');
  if (isOpen) { closeAIToolsPanel(); return; }
  dockTray('aitools-overlay');
  const p = projects.find((x) => x.id === activeProjectId);
  document.getElementById('aitools-active-project').innerText = p ? p.name : 'none';
}

function closeAIToolsPanel() {
  document.getElementById('aitools-overlay').classList.remove('open');
}

function aiToolsRequireFolder() {
  const folder = activeProjectFolder();
  if (!folder) alert('No active project. Launch one from the Projects tab first.');
  return folder;
}

function aiToolsPrint(elId, data) {
  document.getElementById(elId).innerText = JSON.stringify(data, null, 2);
}

async function aiToolsScanInventory() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  aiToolsPrint('aitools-out-inventory', await window.nexus.aiFwScanInventory(folder));
}

async function aiToolsGetMetrics() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  aiToolsPrint('aitools-out-metrics', await window.nexus.aiFwMetricsSummary(folder));
}

async function aiToolsRunGuardrails() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  document.getElementById('aitools-out-guardrails').innerText = 'Running…';
  aiToolsPrint('aitools-out-guardrails', await window.nexus.aiFwRunGuardrails(folder));
}

async function aiToolsApplyUpgrade() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  const configFile = document.getElementById('aitools-upgrade-file').value.trim();
  const find = document.getElementById('aitools-upgrade-find').value;
  const replace = document.getElementById('aitools-upgrade-replace').value;
  if (!configFile || !find) { alert('Config file and text to find are required.'); return; }
  if (!confirm(`This will edit ${configFile} in the active project (with an automatic rollback if guardrail tests or lint fail). Continue?`)) return;
  document.getElementById('aitools-out-upgrade').innerText = 'Applying…';
  aiToolsPrint('aitools-out-upgrade', await window.nexus.aiFwApplyUpgrade(folder, { configFile, find, replace }));
}

async function aiToolsSavePromptVariant() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  const name = document.getElementById('aitools-prompt-name').value.trim();
  const prompt = document.getElementById('aitools-prompt-text').value;
  if (!name || !prompt) { alert('Variant name and prompt text are required.'); return; }
  aiToolsPrint('aitools-out-prompts', await window.nexus.aiFwSavePromptVariant(folder, { name, prompt }));
}

async function aiToolsRecordPromptResult() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  const variantName = document.getElementById('aitools-prompt-result-name').value.trim();
  const score = parseFloat(document.getElementById('aitools-prompt-result-score').value);
  if (!variantName || Number.isNaN(score)) { alert('Variant name and a numeric score are required.'); return; }
  aiToolsPrint('aitools-out-prompts', await window.nexus.aiFwRecordPromptResult(folder, variantName, { score }));
}

async function aiToolsComparePrompts() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  aiToolsPrint('aitools-out-prompts', await window.nexus.aiFwComparePrompts(folder));
}

async function aiToolsAuditDependencies() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  document.getElementById('aitools-out-deps').innerText = 'Auditing…';
  aiToolsPrint('aitools-out-deps', await window.nexus.aiFwAuditDependencies(folder));
}

async function aiToolsComplianceStatus() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  aiToolsPrint('aitools-out-compliance', await window.nexus.aiFwComplianceStatus(folder));
}

async function aiToolsGenerateChangelog() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  aiToolsPrint('aitools-out-changelog', await window.nexus.aiFwGenerateChangelog(folder, 30));
}

async function aiToolsAddKnowledge() {
  const title = document.getElementById('aitools-kb-title').value.trim();
  const lesson = document.getElementById('aitools-kb-lesson').value.trim();
  if (!title || !lesson) { alert('Title and lesson are required.'); return; }
  const p = projects.find((x) => x.id === activeProjectId);
  aiToolsPrint('aitools-out-kb', await window.nexus.aiFwKnowledgeAdd({ title, lesson, project: p ? p.name : null }));
}

async function aiToolsListKnowledge() {
  aiToolsPrint('aitools-out-kb', await window.nexus.aiFwKnowledgeList());
}

async function trainingRefreshSummary() {
  aiToolsPrint('aitools-out-training', await window.nexus.trainingSummary());
}

async function trainingPrepareDataset() {
  const output = document.getElementById('aitools-out-training');
  output.innerText = 'Redacting, validating, and building JSONL…';
  aiToolsPrint('aitools-out-training', await window.nexus.trainingPrepare());
}

function trainingProviderChanged() {
  const local = document.getElementById('training-provider').value === 'local-lora';
  document.getElementById('training-python-row').style.display = local ? '' : 'none';
}

async function trainingChoosePython() {
  const result = await window.nexus.trainingChoosePython();
  if (result.ok) document.getElementById('training-python').value = result.path;
}

async function trainingStart() {
  const provider = document.getElementById('training-provider').value;
  const model = document.getElementById('training-model').value.trim();
  const pythonExecutable = document.getElementById('training-python').value.trim();
  if (!model) return alert('Enter a compatible base model.');
  if (provider === 'local-lora' && !pythonExecutable) return alert('Choose the Python environment used for local LoRA training.');
  const destination = provider === 'openai' ? 'upload the redacted dataset to OpenAI and may incur charges' : 'run weight training on this computer and may use substantial GPU memory, disk space, and time';
  if (!confirm(`Nexus will ${destination}. The dataset contains only examples that passed project checks. Start training now?`)) return;
  document.getElementById('aitools-out-training').innerText = 'Starting the approved training run…';
  const result = await window.nexus.trainingStart({ provider, model, pythonExecutable, approved:true });
  if (result.jobId) document.getElementById('training-job-id').value = result.jobId;
  aiToolsPrint('aitools-out-training', result);
}

async function trainingCheckStatus() {
  const jobId = document.getElementById('training-job-id').value.trim();
  if (!jobId) return alert('Start a training job first.');
  aiToolsPrint('aitools-out-training', await window.nexus.trainingStatus(jobId));
}

async function aiToolsCreateExperiment() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  const name = document.getElementById('aitools-exp-name').value.trim();
  const variantA = document.getElementById('aitools-exp-a').value.trim();
  const variantB = document.getElementById('aitools-exp-b').value.trim();
  if (!name || !variantA || !variantB) { alert('Experiment name and both variant names are required.'); return; }
  aiToolsPrint('aitools-out-experiments', await window.nexus.aiFwCreateExperiment(folder, { name, variantA, variantB }));
}

async function aiToolsRecordObservation() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  const name = document.getElementById('aitools-obs-name').value.trim();
  const variant = document.getElementById('aitools-obs-variant').value.trim();
  const value = parseFloat(document.getElementById('aitools-obs-value').value);
  if (!name || !variant || Number.isNaN(value)) { alert('Experiment name, variant name, and a numeric value are required.'); return; }
  aiToolsPrint('aitools-out-experiments', await window.nexus.aiFwRecordObservation(folder, { name, variant, value }));
}

async function aiToolsAnalyzeExperiment() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  const name = document.getElementById('aitools-analyze-name').value.trim();
  if (!name) { alert('Experiment name is required.'); return; }
  aiToolsPrint('aitools-out-experiments', await window.nexus.aiFwAnalyzeExperiment(folder, name));
}

async function aiToolsGetRecommendations() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  document.getElementById('aitools-out-recommendations').innerText = 'Analyzing…';
  aiToolsPrint('aitools-out-recommendations', await window.nexus.aiFwGetRecommendations(folder));
}

async function aiToolsGetTrendAlerts() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  aiToolsPrint('aitools-out-alerts', await window.nexus.aiFwGetTrendAlerts(folder));
}

async function aiToolsSetPricing() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  const model = document.getElementById('aitools-price-model').value.trim();
  const priceIn = parseFloat(document.getElementById('aitools-price-in').value);
  const priceOut = parseFloat(document.getElementById('aitools-price-out').value);
  if (!model || Number.isNaN(priceIn) || Number.isNaN(priceOut)) { alert('Model name and both prices ($ per 1M tokens) are required.'); return; }
  aiToolsPrint('aitools-out-cost', await window.nexus.aiFwSetPricing(folder, model, priceIn, priceOut));
}

async function aiToolsEstimateCosts() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  aiToolsPrint('aitools-out-cost', await window.nexus.aiFwEstimateCosts(folder));
}

async function aiToolsPerformanceProfile() {
  const folder = aiToolsRequireFolder();
  if (!folder) return;
  aiToolsPrint('aitools-out-performance', await window.nexus.aiFwPerformanceProfile(folder));
}
