// renderer.js — runs in the UI. It has NO direct filesystem/process access;
// everything real happens through window.nexus (exposed by preload.js),
// which forwards to main.js. localStorage here is only used to remember
// your project list between launches — it is not standing in for real work.

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
}

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
const PROJECTS_SCHEMA_VERSION = 1;

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
  if (document.getElementById('activity-overlay').style.display === 'block') { closeActivityView(); return; }
  if (document.getElementById('recentchanges-overlay').style.display === 'block') { closeRecentChanges(); return; }
  if (document.getElementById('pkgmgr-overlay').style.display === 'block') { closePackageManager(); return; }
  if (document.getElementById('docker-overlay').style.display === 'block') { closeDockerPanel(); return; }
  if (document.getElementById('api-tester-overlay').style.display === 'block') { closeApiTester(); return; }
  if (document.getElementById('code-editor-overlay').style.display === 'block') { closeCodeEditor(); return; }
});

function switchTab(tabId) {
  document.querySelectorAll('.view-pane').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById('view-' + tabId).classList.add('active');
  document.getElementById('tab-btn-' + tabId).classList.add('active');
  if (tabId === 'workspace') {
    setTimeout(() => document.getElementById('term-input').focus(), 50);
    if (!currentAssistFolder) onTargetChange();
    refreshGitStatus();
    const p = projects.find((x) => x.id === activeProjectId);
    document.getElementById('deploy-command').value = p?.deployCommand || '';
  }
}

// ---------- Projects ----------
async function browseFolder() {
  const folder = await window.nexus.pickFolder();
  if (folder) document.getElementById('project-path').value = folder;
}

window.nexus.onProjectCloneLog(({ line }) => {
  const el = document.getElementById('clone-progress');
  if (el) el.innerText = line;
});

function persistProjects() {
  localStorage.setItem('nexus_projects', JSON.stringify(projects));
  localStorage.setItem('nexus_active', JSON.stringify(activeProjectId));
  localStorage.setItem('nexus_projects_schema_version', String(PROJECTS_SCHEMA_VERSION));
}

let editingProjectId = null;

async function generateNewProjectUI(e) {
  const name = document.getElementById('new-project-name').value.trim();
  const description = document.getElementById('new-project-description').value.trim();
  const progressEl = document.getElementById('new-project-progress');

  if (!name || !description) {
    alert('Give the new project a name and describe what it should do.');
    return;
  }

  const btn = e.target;
  btn.disabled = true;
  progressEl.innerText = 'Asking NVIDIA NIM to generate the starter project… this can take up to a minute for a real, complete file set.';

  const result = await window.nexus.generateNewProject(name, description);

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
    port: '3000',
    running: false,
  };
  projects.push(newProject);
  activeProjectId = newProject.id;
  persistProjects();
  renderProjects();

  showToast('success', `Generated ${result.files.length} file(s)`, `${result.path}\n\nOpening in the Code Editor for review.`);
  await toggleCodeEditor();
}

async function addProject(e) {
  const name = document.getElementById('project-name').value.trim();
  const rawInput = document.getElementById('project-path').value.trim();
  const command = document.getElementById('project-command').value.trim() || 'npm run dev';
  const port = document.getElementById('project-port').value.trim() || '3000';
  const progressEl = document.getElementById('clone-progress');

  if (!name || !rawInput) {
    alert('Give the project a name, then either pick a folder or paste a GitHub URL.');
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
    }
    editingProjectId = null;
    saveBtn.innerText = 'Save Project';
    saveBtn.disabled = false;
    document.getElementById('project-name').value = '';
    document.getElementById('project-path').value = '';
    document.getElementById('project-command').value = 'npm run dev';
    document.getElementById('project-port').value = '3000';
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

  projects.push({ id: Date.now(), name, folder, command, port, running: false });
  document.getElementById('project-name').value = '';
  document.getElementById('project-path').value = '';
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
  document.getElementById('project-port').value = '3000';
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
  const active = projects.find((p) => p.id === activeProjectId);
  document.getElementById('header-active-name').innerText = active ? active.name : 'None';
}

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
  const isOpen = overlay.style.display === 'block';
  if (isOpen) { closePipelinePanel(); return; }
  overlay.style.display = 'block';
  setTimeout(() => document.getElementById('pipeline-input').focus(), 30);
}

function closePipelinePanel() {
  document.getElementById('pipeline-overlay').style.display = 'none';
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
  const isOpen = overlay.style.display === 'block';
  if (isOpen) { closeActivityView(); return; }
  overlay.style.display = 'block';
  await refreshActivityView();
}

function closeActivityView() {
  document.getElementById('activity-overlay').style.display = 'none';
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
  const isOpen = overlay.style.display === 'block';
  if (isOpen) { closeRecentChanges(); return; }
  overlay.style.display = 'block';
  await refreshRecentChanges();
}

function closeRecentChanges() {
  document.getElementById('recentchanges-overlay').style.display = 'none';
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
  const isOpen = overlay.style.display === 'block';
  if (isOpen) { closePackageManager(); return; }

  const folder = activeProjectFolder();
  const p = projects.find((x) => x.id === activeProjectId);
  document.getElementById('pkgmgr-project-name').innerText = p ? p.name : 'No active project';

  if (!folder) {
    alert('No active project. Launch or select one from the Projects tab first.');
    return;
  }

  overlay.style.display = 'block';
  pkgmgrOutdated = {};
  await refreshPackageList();
}

function closePackageManager() {
  document.getElementById('pkgmgr-overlay').style.display = 'none';
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
  const isOpen = overlay.style.display === 'block';
  if (isOpen) { closeDockerPanel(); return; }

  overlay.style.display = 'block';

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
  document.getElementById('docker-overlay').style.display = 'none';
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
  const isOpen = overlay.style.display === 'block';
  if (isOpen) { closeApiTester(); return; }

  apiCurrentFolder = activeProjectFolder();
  overlay.style.display = 'block';

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
  document.getElementById('api-tester-overlay').style.display = 'none';
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
  const isOpen = overlay.style.display === 'block';
  if (isOpen) { closeCodeEditor(); return; }

  codeEditorFolder = activeProjectFolder();
  const p = projects.find((x) => x.id === activeProjectId);
  document.getElementById('editor-project-name').innerText = p ? p.name : 'No active project';

  if (!codeEditorFolder) {
    alert('No active project. Launch or select one from the Projects tab first.');
    return;
  }

  overlay.style.display = 'block';

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
      }
    });
    codeEditorCM.setOption('extraKeys', {
      'Ctrl-S': () => { saveCurrentEditorFile(); return false; },
      'Cmd-S': () => { saveCurrentEditorFile(); return false; },
    });
  }

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
  document.getElementById('code-editor-overlay').style.display = 'none';
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

  panelEl.innerHTML = messages.map((m) => `
    <div class="ce-lint-item ce-lint-${m.severity}" onclick="jumpToLintLine(${m.line})">
      <span class="ce-lint-dot">●</span>
      <span class="ce-lint-line">Line ${m.line}</span>
      <span>${escapeHtml(m.message)}</span>
      <span class="ce-lint-rule">${escapeHtml(m.ruleId || '')}</span>
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
  document.getElementById('code-editor-filetree').style.display = 'block';
  document.getElementById('code-editor-search-panel').style.display = 'none';
}

function showCodeEditorSearch() {
  document.getElementById('cet-mode-files-btn').classList.remove('active');
  document.getElementById('cet-mode-search-btn').classList.add('active');
  document.getElementById('code-editor-filetree').style.display = 'none';
  document.getElementById('code-editor-search-panel').style.display = 'flex';
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
  document.getElementById('ce-diff-explanation').innerText = result.explanation || '';
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
  const result = await window.nexus.geminiAsk(prompt);
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
      `Backups (.bak) are still made, but you will not review changes before they're written.\n\n` +
      `Type exactly: ${phrase}`
    );
    if (typed !== phrase) {
      box.checked = false;
      autonomousMode = false;
      return;
    }
    autonomousMode = true;
  } else {
    autonomousMode = false;
  }
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
  document.getElementById('proposal-explanation').innerText = result.explanation;
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
  const result = await window.nexus.gitStatus(folder);
  if (!result.ok) {
    document.getElementById('git-branch-display').innerText = 'branch: —';
    document.getElementById('git-status-display').innerText = result.error;
    document.getElementById('git-diff-file-list').innerHTML = '';
    return;
  }
  document.getElementById('git-branch-display').innerText = `branch: ${result.branch}`;
  document.getElementById('git-status-display').innerText = result.status;
  await refreshGitDiff(folder);
}

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
      <div class="ch-meta">${escapeHtml(c.author)} — ${escapeHtml(c.date)}${c.branches.map((b) => `<span class="ch-branch-tag">${escapeHtml(b)}</span>`).join('')}</div>
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

  const commitResult = await window.nexus.gitCommit(folder, message);
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
  listEl.innerHTML = result.keys.map((k) => `
    <div class="suggestion-item" data-key="${escapeHtml(k)}">
      <strong>${escapeHtml(k)}</strong>
      <div class="row" style="margin-top:6px;">
        <button class="btn btn-secondary tiny" onclick="revealSecret(this)">Show</button>
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
  const result = await window.nexus.saveProjectSecret(p.projectUid, key, value);
  if (!result.ok) { alert('Failed to save: ' + result.error); return; }
  document.getElementById('secret-key-name').value = '';
  document.getElementById('secret-key-value').value = '';
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

  const result = await window.nexus.runTestsDetailed(folder);

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

  renderTestResultsList();
}

function renderTestResultsList() {
  const listEl = document.getElementById('test-results-list');
  listEl.innerHTML = lastTestResults.map((t, i) => `
    <div class="tr-row">
      <span class="tr-icon tr-icon-${t.status}">${t.status === 'pass' ? '✓' : t.status === 'fail' ? '✕' : '○'}</span>
      <span class="tr-name" title="${escapeHtml(t.name)}" onclick="${t.failureMessage ? `toggleTestFailureMessage(${i})` : ''}" style="${t.failureMessage ? 'cursor:pointer;' : ''}">${escapeHtml(t.name)}</span>
      <span class="tr-duration">${t.duration ? t.duration + 'ms' : ''}</span>
      ${t.status === 'fail' ? `<button class="btn tiny btn-secondary tr-rerun" onclick="rerunSingleTest(${i}, event)">↻ Rerun</button>` : ''}
    </div>
    ${t.failureMessage ? `<div class="tr-failure-message" id="tr-fail-${i}">${escapeHtml(t.failureMessage)}</div>` : ''}
  `).join('') || '<p class="muted small">No tests ran.</p>';
}

function toggleTestFailureMessage(index) {
  document.getElementById(`tr-fail-${index}`)?.classList.toggle('open');
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
    badge.innerText = `Build #${buildInfo.buildNumber} (${buildInfo.commitHash})`;
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
  const gcp = await window.nexus.getGcpProject();
  if (gcp) document.getElementById('gcp-project-id').value = gcp;

  await loadBuildInfoAndCheckUpdates();

  updateActivityDot();
})();
// GitHub is connected with a pasted Personal Access Token (stored encrypted
// via the same saveGeminiKey-style path), not an OAuth app flow - Nexus
// isn't a registered GitHub OAuth App, so a real device-flow "Authorize"
// button would have nothing to talk to. This is the honest, working version.
async function githubConnect() {
  const input = document.getElementById('github-token');
  const token = input.value.trim();
  if (!token) { alert('Paste a GitHub personal access token first.'); return; }

  const result = await window.nexus.saveGitHubToken(token);
  if (result && result.ok) {
    input.value = '';
    showToast('success', '✅ GitHub connected', 'Ship-tab GitHub actions and the AI Changelog can now use it.');
  } else {
    showToast('error', 'Could not save token', result?.error || 'Unknown error');
  }
  refreshGitHubStatus();
}

async function githubDisconnect() {
  if (!confirm('Remove the saved GitHub token?')) return;
  await window.nexus.clearGitHubToken();
  refreshGitHubStatus();
  showToast('info', 'Disconnected');
}

async function refreshGitHubStatus() {
  const statusEl = document.getElementById('github-status');
  if (!statusEl) return;
  const connected = await window.nexus.hasGitHubToken();
  statusEl.innerText = connected ? '✅ Connected' : 'Not connected.';
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
  const isOpen = overlay.style.display === 'block';
  if (isOpen) { closeAIToolsPanel(); return; }
  overlay.style.display = 'block';
  const p = projects.find((x) => x.id === activeProjectId);
  document.getElementById('aitools-active-project').innerText = p ? p.name : 'none';
}

function closeAIToolsPanel() {
  document.getElementById('aitools-overlay').style.display = 'none';
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
