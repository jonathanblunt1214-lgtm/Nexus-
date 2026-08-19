// renderer.js — runs in the UI. It has NO direct filesystem/process access;
// everything real happens through window.nexus (exposed by preload.js),
// which forwards to main.js. localStorage here is only used to remember
// your project list between launches — it is not standing in for real work.

let projects = JSON.parse(localStorage.getItem('nexus_projects') || '[]');
let activeProjectId = JSON.parse(localStorage.getItem('nexus_active') || 'null');

// ---------- Tabs ----------
function switchTab(tabId) {
  document.querySelectorAll('.view-pane').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById('view-' + tabId).classList.add('active');
  document.getElementById('tab-btn-' + tabId).classList.add('active');
  if (tabId === 'terminal') setTimeout(() => document.getElementById('term-input').focus(), 50);
  if (tabId === 'assist' && !currentAssistFolder) onTargetChange();
  if (tabId === 'ship') {
    refreshGitStatus();
    const p = projects.find((x) => x.id === activeProjectId);
    document.getElementById('deploy-command').value = p?.deployCommand || '';
  }
  if (tabId === 'config') renderConfigTab();
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

function removeProject(id, e) {
  e.stopPropagation();
  const p = projects.find((x) => x.id === id);
  if (p && p.running) window.nexus.stopProject(id);
  projects = projects.filter((x) => x.id !== id);
  if (activeProjectId === id) activeProjectId = null;
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
    const result = await window.nexus.launchProject(id, p.folder, p.command, p.port);
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
    switchTab('preview');
    // Give the dev server a moment to boot before we point the webview at it.
    setTimeout(loadPreview, 1500);
  }
  persistProjects();
  renderProjects();
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
    const card = document.createElement('div');
    card.className = 'project-card' + (p.running ? ' running' : '');
    card.innerHTML = `
      <div>
        <div class="row" style="justify-content:space-between; align-items:center;">
          <strong>${escapeHtml(p.name)}</strong>
          <button onclick="removeProject(${p.id}, event)" style="background:none; border:none; color:var(--danger); cursor:pointer;">✕</button>
        </div>
        <p class="path">${escapeHtml(p.folder)}</p>
        <p class="meta">${escapeHtml(p.command)} — port ${escapeHtml(p.port)}</p>
      </div>
      <div class="row">
        <button class="btn ${p.running ? 'btn-secondary' : ''}" style="flex:1;" onclick="toggleProject(${p.id}, event)">
          ${p.running ? '■ Stop' : '▶ Launch'}
        </button>
        <span class="pill ${p.running ? 'on' : ''}">${p.running ? 'RUNNING' : 'STOPPED'}</span>
      </div>
    `;
    list.appendChild(card);
  });
  const active = projects.find((p) => p.id === activeProjectId);
  document.getElementById('header-active-name').innerText = active ? active.name : 'None';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.innerText = str;
  return d.innerHTML;
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
function loadPreview() {
  const url = document.getElementById('preview-url').value.trim();
  if (url) document.getElementById('preview-frame').src = url;
}

function openInBrowser() {
  const url = document.getElementById('preview-url').value.trim();
  if (url) window.nexus.openExternal(url);
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

async function saveClaudeKey() {
  const key = document.getElementById('claude-api-key').value.trim();
  if (!key) return;
  await window.nexus.saveClaudeKey(key);
  document.getElementById('claude-api-key').value = '';
  refreshClaudeStatus();
}

async function clearClaudeKey() {
  await window.nexus.clearClaudeKey();
  refreshClaudeStatus();
}

async function refreshClaudeStatus() {
  const has = await window.nexus.hasClaudeKey();
  document.getElementById('claude-status').innerText = has
    ? 'A key is saved (encrypted on disk). Bug Fix Assist & Feature Suggestions are ready.'
    : 'No key saved yet — Bug Fix Assist & Feature Suggestions need this to work.';
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
    const applied = await window.nexus.applyFileChange(result.filePath, result.newContent);
    if (applied.ok) {
      alert(`Autonomously applied a fix to ${relFile}. Backup saved at ${applied.backupPath}.`);
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
  const applied = await window.nexus.applyFileChange(pendingProposal.filePath, pendingProposal.newContent);
  if (applied.ok) {
    alert(`Applied. Backup saved at ${applied.backupPath}.`);
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
    return;
  }
  const result = await window.nexus.gitStatus(folder);
  if (!result.ok) {
    document.getElementById('git-branch-display').innerText = 'branch: —';
    document.getElementById('git-status-display').innerText = result.error;
    return;
  }
  document.getElementById('git-branch-display').innerText = `branch: ${result.branch}`;
  document.getElementById('git-status-display').innerText = result.status;
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
      alert('Review the changelog entry below, click "Save to Files," then click Commit & Push again when ready.');
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
    alert('Committed and pushed.');
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
  const applied = await window.nexus.applyFileChange(featurePendingProposal.filePath, featurePendingProposal.newContent);
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
  alert('Saved to CHANGELOG.md and release-notes.md.');
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

const SMOKESTACK_CONSTITUTION_V5 = `# SMOKESTACK APP CONSTITUTION (AMENDED)
**Status:** Governing law
**Revision:** 4
**Applies to:** Every SmokeStack client, server, background job, deployment, integration, AI response, administrator surface, data migration, and release artifact.

---

### 1. SUPREMACY AND SCOPE
This Constitution governs all SmokeStack code and behavior. Product copy, feature requests, generated code, migrations, integrations, and release instructions are subordinate to it. A feature that cannot pass its constitutional gate remains unavailable and must be labeled unavailable.

### 2. TRUTH AND NON-FABRICATION
* **2.1** Unknown means unknown. Missing data is never replaced by a plausible value.
* **2.2** SmokeStack must not fabricate cooks, smoker hours, fuel, prices, telemetry, device connections, identities, AI memory, verification, timestamps, backup success, synchronization, deployment, or store availability.
* **2.3** Demonstration and simulated data must be labeled DEMO or SIMULATED when it is created and must retain that provenance everywhere it is used.
* **2.4** Success language is permitted only after the corresponding operation has succeeded and been verified.
* **2.5** Configuration is not connection. Network availability is not AI grounding. A selected catalog item is not a paired device.

### 3. AUTHORITATIVE DATA AND IDENTITY
* **3.1** Firebase Authentication establishes account identity. Client-supplied email addresses, device IDs, query parameters, and local storage never grant identity, permissions, or access to account data.
* **3.2** All user data (cook logs, equipment records, photos, recipes, notes, preferences, backups, and community submissions) remains exclusively owned by the user. No upload, synchronization, backup, analysis, or contribution transfers title to SmokeStack.
* **3.3** UID scoping is mandatory for all private user data operations. Cross-account data leakage is a critical constitutional failure.

### 4. CONSTITUTIONAL EXCEPTIONS AND OVERRIDES (NEW)
* **4.1 Absurdity Exception:** Strict literal enforcement of any constitutional clause that results in demonstrably absurd, self-contradictory, or catastrophic operational lock-out is nullified in that specific instance, provided the override preserves absolute data integrity, non-fabrication of telemetry, and explicit user consent.
* **4.2 Contextual Override Mechanism:** Authorized administrative operations or verified real-time runtime constraints may invoke a contextual override to bypass rigid fallback blocks, provided the override event is fully auditable, leaves an unalterable log trail, and is never used to fabricate data or bypass user-ownership protections.
* **4.3 Purpose-Driven Execution:** All system actions, UI rendering paths, and AI workflows shall execute dynamically to fulfill their verified user intent and functional purpose, preventing mechanical rigidity from breaking usable software interfaces or blocking legitimate operational workflows.

### 5. GATE AND FAILURE BEHAVIOR
Every change follows this strict sequence:
AUDIT -> REPAIR -> TEST -> GATE -> REPORT -> RELEASE
If any gate fails, release stops. The failure remains visible and is not converted into simulated success, fallback data, or optimistic copy.
`;

function loadSmokeStackTemplate() {
  if (document.getElementById('constitution-text').value.trim() &&
      !confirm('This will replace the current text in the box (not yet saved). Continue?')) return;
  document.getElementById('constitution-text').value = SMOKESTACK_CONSTITUTION_V5;
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
  alert('Saved CONSTITUTION.md. Bug Fix Assist and Feature Builder will now follow it for this project.');
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
  alert(`Wrote ${result.count} variable(s) to .env.`);
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

  const auditGatePassed = audit.ok || (repairRan && repair && repair.ok);
  pipelineGatePassed = auditGatePassed && tests.ok;

  gatePill.innerText = pipelineGatePassed ? 'GATE: PASSED' : 'GATE: FAILED';
  gatePill.className = 'pill' + (pipelineGatePassed ? ' on' : '');
}

// ---------- Init ----------
(async function init() {
  renderProjects();
  updatePrompt();
  refreshGeminiStatus();
  refreshClaudeStatus();
  const gcp = await window.nexus.getGcpProject();
  if (gcp) document.getElementById('gcp-project-id').value = gcp;
})();