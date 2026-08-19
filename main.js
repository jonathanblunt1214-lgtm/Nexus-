// main.js — Electron "main process". This is the part that runs with full
// Node.js access: it can touch the real filesystem, spawn real processes,
// and make real network calls. The UI (renderer) never gets this power
// directly — it only talks to this file through the safe bridge in
// preload.js. That separation is what makes it safe to load web-ish UI code.

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');
const crypto = require('crypto');
const { resolveProjectPath } = require('./projectCloner');
const { initUpdater, checkForUpdates, downloadUpdate, installUpdateAndRestart } = require('./updater');

let mainWindow;

// Where we persist small bits of config (encrypted Gemini key, GCP project id).
const CONFIG_PATH = path.join(app.getPath('userData'), 'nexus-config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// ---- Terminal state -------------------------------------------------
// A real "cd" doesn't persist across separate child_process calls, so we
// track the working directory ourselves and special-case `cd`.
let terminalCwd = os.homedir();

// ---- Running dev-server processes ------------------------------------
// Map of projectId -> spawned child process, so we can stream output and
// stop them later.
const runningProcesses = new Map();

function killProcessTree(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM'); // negative pid = whole process group
    } catch {
      child.kill('SIGTERM');
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#030712',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // needed for the real live-preview panel
      sandbox: false,
    },
  });

  mainWindow.loadFile('index.html');
  // Uncomment while developing to see console errors from the UI:
  // mainWindow.webContents.openDevTools();
}

function setupPreviewSession() {
  // The Preview tab's webview runs in its own dedicated session partition
  // (see index.html: partition="persist:nexus-preview"). Local dev servers
  // often send their own Content-Security-Policy / X-Frame-Options headers -
  // entirely reasonable for a real deployed app, but Electron's webview still
  // respects them, and Nexus's own window (loaded via file://) doesn't match
  // most frame-ancestors policies even when they look permissive (e.g. "*"
  // only matches network-scheme origins, not file://). Since this partition
  // is used exclusively to preview the user's own local projects - never
  // arbitrary third-party sites - stripping these specific framing headers
  // here is safe and is exactly what a local dev-preview tool needs to do.
  const previewSession = session.fromPartition('persist:nexus-preview');
  previewSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'content-security-policy' || lower === 'x-frame-options') {
        delete headers[key];
      }
    }
    callback({ responseHeaders: headers });
  });

  // This partition uses "persist:" so a signed-in session (Firebase auth,
  // stored in localStorage/IndexedDB) survives between Nexus launches -
  // without it, users would have to sign in again every time. But "persist:"
  // also means any Service Worker a previewed project registers sticks
  // around forever too, including a broken/stale one from an earlier dev
  // session that can silently break every future page load by intercepting
  // and mishandling requests (e.g. Vite's dev-mode HMR requests). Clearing
  // just the service-worker storage on every startup keeps auth intact while
  // guaranteeing each session starts with no leftover, possibly-broken
  // service workers from a previous run.
  previewSession.clearStorageData({ storages: ['serviceworkers'] }).catch((err) => {
    console.error('Failed to clear stale service workers:', err.message);
  });
}

// --- Popup allowlist for the Preview webview ----------------------------
// The webview has `allowpopups` set (needed for real Google/Firebase sign-in
// flows), which by itself would let ANY page it loads open ANY popup window -
// too broad for something whose whole purpose is previewing arbitrary local
// projects. Instead: every popup request is checked against a known list of
// legitimate auth-provider domains, plus localhost/127.0.0.1 (same machine,
// same trust level as the preview itself). Anything else is denied outright
// and logged - never silently allowed "just in case."
const ALLOWED_POPUP_HOSTS = [
  'accounts.google.com',
  'accounts.youtube.com', // Google's auth flow sometimes routes through this
  'appleid.apple.com',
  'github.com',
  'login.microsoftonline.com',
  'login.live.com',
  'www.facebook.com',
  'api.twitter.com',
  'twitter.com',
  'x.com',
];

function isAllowedPopupUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false; // unparseable URL - never allow
  }

  const host = parsed.hostname.toLowerCase();

  // Any localhost/127.0.0.1 popup is same-machine, same-trust-level as the
  // project being previewed - always allowed regardless of port.
  if (host === 'localhost' || host === '127.0.0.1') return true;

  // Firebase's own auth-handler popups live on <project-id>.firebaseapp.com
  // or <project-id>.web.app - can't allowlist every project id in advance,
  // so match the pattern instead of a fixed list.
  if (host.endsWith('.firebaseapp.com') || host.endsWith('.web.app')) return true;

  return ALLOWED_POPUP_HOSTS.includes(host);
}

function setupPopupAllowlist() {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;

    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedPopupUrl(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          },
        };
      }
      console.warn(`[preview] Blocked popup to non-allowlisted host: ${url}`);
      return { action: 'deny' };
    });
  });
}

app.whenReady().then(() => {
  createWindow();
  setupPreviewSession();
  setupPopupAllowlist();
  initUpdater(mainWindow);
  checkForUpdates().catch((err) => {
    console.error('Update check failed:', err.message);
  });
});

app.on('window-all-closed', () => {
  // Make sure we don't leave dev servers running as orphaned processes.
  for (const child of runningProcesses.values()) killProcessTree(child);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// =======================================================================
// IPC handlers — everything the renderer (UI) is allowed to ask us to do.
// =======================================================================

// --- Folder picker: real native OS dialog ---
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// --- Resolve whatever the user typed/pasted into the project path field:
// a real local folder is returned as-is; a GitHub URL is cloned first into
// the configured projects folder (default: Documents\Nexus Projects), with
// live progress streamed to the renderer so the UI isn't just frozen.
// --- Manual preview cache clear, in case a stale/broken service worker
// shows up mid-session rather than only at startup ---
ipcMain.handle('clear-preview-cache', async () => {
  try {
    const previewSession = session.fromPartition('persist:nexus-preview');
    await previewSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('resolve-project-path', async (_event, { input }) => {
  try {
    const resolvedPath = await resolveProjectPath(input, (line) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project-clone-log', { line });
      }
    });
    return { ok: true, path: resolvedPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- Auto-updater: checks GitHub Releases for a newer Nexus build ---
ipcMain.handle('updater:check', () => checkForUpdates());
ipcMain.handle('updater:download', () => downloadUpdate());
ipcMain.handle('updater:install', () => installUpdateAndRestart());

// --- Terminal: run a real shell command in the tracked cwd ---
ipcMain.handle('exec-command', async (_event, { cmd }) => {
  const trimmed = (cmd || '').trim();
  if (!trimmed) return { output: '', cwd: terminalCwd };

  if (trimmed === 'pwd') {
    return { output: terminalCwd, cwd: terminalCwd };
  }

  if (trimmed.startsWith('cd')) {
    const target = trimmed.slice(2).trim() || os.homedir();
    const resolved = path.resolve(terminalCwd, target.replace(/^"|"$/g, ''));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return { output: `cd: no such directory: ${target}`, cwd: terminalCwd };
    }
    terminalCwd = resolved;
    return { output: '', cwd: terminalCwd };
  }

  return new Promise((resolve) => {
    exec(trimmed, { cwd: terminalCwd, shell: true, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let output = stdout || '';
        if (stderr) output += (output ? '\n' : '') + stderr;
        if (error && !output) output = error.message;
        resolve({ output, cwd: terminalCwd });
      });
  });
});

ipcMain.handle('get-cwd', () => terminalCwd);

// --- Project launcher: spawn a real dev-server process ---
ipcMain.handle('launch-project', (_event, { id, folder, command, port, projectUid }) => {
  if (runningProcesses.has(id)) {
    return { ok: false, error: 'Already running.' };
  }
  if (!fs.existsSync(folder)) {
    return { ok: false, error: `Folder does not exist: ${folder}` };
  }

  const secretsEnv = projectUid ? decryptAllProjectSecrets(projectUid) : {};

  let child;
  try {
    child = spawn(command, {
      cwd: folder,
      shell: true,
      detached: process.platform !== 'win32', // lets us kill the whole group later
      env: { ...process.env, PORT: String(port || ''), ...secretsEnv },
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  runningProcesses.set(id, child);

  child.stdout.on('data', (data) => {
    mainWindow?.webContents.send('project-log', { id, text: data.toString() });
  });
  child.stderr.on('data', (data) => {
    mainWindow?.webContents.send('project-log', { id, text: data.toString() });
  });
  child.on('close', (code) => {
    runningProcesses.delete(id);
    mainWindow?.webContents.send('project-closed', { id, code });
  });
  child.on('error', (err) => {
    runningProcesses.delete(id);
    mainWindow?.webContents.send('project-log', { id, text: `\n[error] ${err.message}\n` });
    mainWindow?.webContents.send('project-closed', { id, code: -1 });
  });

  return { ok: true };
});

ipcMain.handle('stop-project', (_event, { id }) => {
  const child = runningProcesses.get(id);
  if (child) {
    killProcessTree(child);
    runningProcesses.delete(id);
  }
  return { ok: true };
});

ipcMain.handle('is-project-running', (_event, { id }) => runningProcesses.has(id));

// --- Open a URL in the user's real default browser ---
ipcMain.handle('open-external', (_event, { url }) => {
  shell.openExternal(url);
});

// --- Gemini API key: stored encrypted at rest via Electron's safeStorage ---
ipcMain.handle('save-gemini-key', (_event, { key }) => {
  const cfg = loadConfig();
  if (safeStorage.isEncryptionAvailable()) {
    cfg.geminiKeyEnc = safeStorage.encryptString(key).toString('base64');
  } else {
    // Fallback for systems without OS-level encryption available.
    cfg.geminiKeyPlain = key;
  }
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle('has-gemini-key', () => {
  const cfg = loadConfig();
  return Boolean(cfg.geminiKeyEnc || cfg.geminiKeyPlain);
});

ipcMain.handle('clear-gemini-key', () => {
  const cfg = loadConfig();
  delete cfg.geminiKeyEnc;
  delete cfg.geminiKeyPlain;
  saveConfig(cfg);
  return { ok: true };
});

function getGeminiKey() {
  const cfg = loadConfig();
  if (cfg.geminiKeyEnc && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(cfg.geminiKeyEnc, 'base64'));
  }
  return cfg.geminiKeyPlain || null;
}

ipcMain.handle('save-gcp-project', (_event, { projectId }) => {
  const cfg = loadConfig();
  cfg.gcpProjectId = projectId;
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle('get-gcp-project', () => loadConfig().gcpProjectId || '');

// --- Claude API key: same encrypted-at-rest pattern as the Gemini key ---
ipcMain.handle('save-claude-key', (_event, { key }) => {
  const cfg = loadConfig();
  if (safeStorage.isEncryptionAvailable()) {
    cfg.claudeKeyEnc = safeStorage.encryptString(key).toString('base64');
  } else {
    cfg.claudeKeyPlain = key;
  }
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle('has-claude-key', () => {
  const cfg = loadConfig();
  return Boolean(cfg.claudeKeyEnc || cfg.claudeKeyPlain);
});

ipcMain.handle('clear-claude-key', () => {
  const cfg = loadConfig();
  delete cfg.claudeKeyEnc;
  delete cfg.claudeKeyPlain;
  saveConfig(cfg);
  return { ok: true };
});

function getClaudeKey() {
  const cfg = loadConfig();
  if (cfg.claudeKeyEnc && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(cfg.claudeKeyEnc, 'base64'));
  }
  return cfg.claudeKeyPlain || null;
}

// --- Shared Claude call. Used by Bug Fix Assist and Feature Suggestions. ---
async function callClaude(prompt) {
  const key = getClaudeKey();
  if (!key) return { ok: false, error: 'No Claude API key saved yet. Add one in the Cloud tab.' };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    }
    const text = (data?.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// =======================================================================
// Project Constitution: a governing document for one project's own rules
// (e.g. "never fabricate telemetry," "unknown means unknown," "no
// optimistic UI states"). If present, every AI Assist / Feature Builder /
// Feature Suggestion call for that project is required to honor it —
// this is what makes it a real constraint instead of an inert file.
// =======================================================================

const CONSTITUTION_FILENAME = 'CONSTITUTION.md';

function loadProjectConstitution(folder) {
  if (!folder) return null;
  const p = path.join(folder, CONSTITUTION_FILENAME);
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function constitutionPreamble(folder) {
  const text = loadProjectConstitution(folder);
  if (!text) return '';
  return [
    'THIS PROJECT HAS A GOVERNING CONSTITUTION.MD THAT TAKES PRECEDENCE OVER GENERAL BEST PRACTICE.',
    'You must follow it strictly in any code you propose. If a request would require violating it,',
    'do not violate it — find a compliant approach, or say in your EXPLANATION why compliance isn\'t possible.',
    '--- PROJECT CONSTITUTION START ---',
    text,
    '--- PROJECT CONSTITUTION END ---',
    '',
  ].join('\n');
}

ipcMain.handle('read-constitution', (_event, { folder }) => {
  const text = loadProjectConstitution(folder);
  return { ok: true, content: text || '' };
});

ipcMain.handle('save-constitution', (_event, { folder, content }) => {
  try {
    const p = path.join(folder, CONSTITUTION_FILENAME);
    if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak');
    fs.writeFileSync(p, content, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- Shared Gemini call, used only by the general "Ask Gemini" box now ---
async function callGemini(prompt) {
  const key = getGeminiKey();
  if (!key) return { ok: false, error: 'No Gemini API key saved yet.' };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

ipcMain.handle('gemini-ask', async (_event, { prompt }) => {
  const result = await callGemini(prompt);
  if (!result.ok) return result;
  return { ok: true, text: result.text || '(empty response)' };
});

// =======================================================================
// Code Assist: bug-fix proposals + feature suggestions + self-update.
// IMPORTANT SAFETY PROPERTY: nothing here ever writes to a file on its own.
// Every write goes through apply-file-change, which is only ever called
// from the renderer after the user clicks Approve (or, in autonomous mode,
// after an explicit in-session opt-in that resets on every relaunch).
// =======================================================================

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out']);

function walkFiles(dir, base, results, depth) {
  if (depth > 6 || results.length > 300) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length > 300) return;
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, rel, results, depth + 1);
    } else {
      results.push(rel);
    }
  }
}

ipcMain.handle('list-project-files', (_event, { folder }) => {
  if (!folder || !fs.existsSync(folder)) return [];
  const results = [];
  walkFiles(folder, '', results, 0);
  return results.sort();
});

ipcMain.handle('get-app-dir', () => __dirname);

ipcMain.handle('read-file', (_event, { filePath }) => {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 300 * 1024) {
      return { ok: false, error: 'File is too large for AI review (300KB limit).' };
    }
    return { ok: true, content: fs.readFileSync(filePath, 'utf8') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Ask Gemini to propose a fixed version of one file. Returns the proposal —
// it does NOT write anything.
ipcMain.handle('ai-propose-fix', async (_event, { filePath, errorText, folder }) => {
  let oldContent;
  try {
    oldContent = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    oldContent = ''; // file may not exist yet — treat as "create new file"
  }

  const prompt = constitutionPreamble(folder) + [
    'You are a careful code-fixing assistant. You will be shown a file and an error message.',
    'Respond in EXACTLY this format, nothing else:',
    'EXPLANATION:',
    '<1-3 sentence plain-English explanation of the bug and the fix>',
    '---NEWFILE---',
    '<the COMPLETE corrected file content, and nothing else after it>',
    '',
    `FILE PATH: ${filePath}`,
    'FILE CONTENT:',
    oldContent,
    '',
    'ERROR / PROBLEM DESCRIPTION:',
    errorText || '(no error text provided — look for obvious bugs)',
  ].join('\n');

  const result = await callClaude(prompt);
  if (!result.ok) return result;

  const marker = '---NEWFILE---';
  const idx = result.text.indexOf(marker);
  if (idx === -1) {
    return { ok: false, error: 'AI response was not in the expected format. Try again.' };
  }
  const explanation = result.text.slice('EXPLANATION:'.length, idx).trim();
  let newContent = result.text.slice(idx + marker.length);
  // Strip a leading newline and any stray markdown code fences the model might add.
  newContent = newContent.replace(/^\n/, '').replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '');

  return { ok: true, oldContent, newContent, explanation, filePath };
});

// The ONLY place a write happens. Always backs up first (if the file already exists).
ipcMain.handle('apply-file-change', (_event, { filePath, newContent }) => {
  try {
    let backupPath = null;
    if (fs.existsSync(filePath)) {
      backupPath = filePath + '.bak';
      fs.copyFileSync(filePath, backupPath);
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    fs.writeFileSync(filePath, newContent, 'utf8');
    return { ok: true, backupPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Advisory only — this handler has no corresponding write path at all.
ipcMain.handle('ai-suggest-features', async (_event, { folder }) => {
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'Folder not found.' };

  let pkg = '(no package.json found)';
  const pkgPath = path.join(folder, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try { pkg = fs.readFileSync(pkgPath, 'utf8'); } catch {}
  }

  const files = [];
  walkFiles(folder, '', files, 0);

  const prompt = constitutionPreamble(folder) + [
    'You are a senior engineer reviewing a project. Suggest 3-6 concrete, useful feature or',
    'quality improvements based on the file list and package.json below.',
    'Respond ONLY with a JSON array, no markdown fences, no other text, in this exact shape:',
    '[{"title": "short title", "why": "1-2 sentence rationale"}]',
    '',
    'package.json:',
    pkg,
    '',
    'Project files:',
    files.slice(0, 200).join('\n'),
  ].join('\n');

  const result = await callClaude(prompt);
  if (!result.ok) return result;

  try {
    const cleaned = result.text.trim().replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '');
    const suggestions = JSON.parse(cleaned);
    return { ok: true, suggestions };
  } catch {
    // Model didn't return clean JSON — hand back the raw text so the UI can still show something.
    return { ok: true, suggestions: null, raw: result.text };
  }
});

// =======================================================================
// Ship: real git actions, a multi-file feature planner, and a deploy-
// script runner. Same safety property as Code Assist — pushing to a
// remote or running your deploy script only ever happens from an explicit
// button click in the renderer, never automatically.
// =======================================================================

function runGit(folder, args) {
  return new Promise((resolve) => {
    exec(`git ${args}`, { cwd: folder, shell: true, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = (stdout || '') + (stderr ? '\n' + stderr : '');
        resolve({ ok: !error, output: output.trim(), error: error ? error.message : null });
      });
  });
}

ipcMain.handle('git-status', async (_event, { folder }) => {
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'Folder not found.' };
  const branch = await runGit(folder, 'branch --show-current');
  const status = await runGit(folder, 'status --short');
  if (!branch.ok) return { ok: false, error: branch.output || 'Not a git repository.' };
  return { ok: true, branch: branch.output || '(detached HEAD)', status: status.output || '(clean)' };
});

ipcMain.handle('git-create-branch', async (_event, { folder, branchName }) => {
  return runGit(folder, `checkout -b "${branchName}"`);
});

ipcMain.handle('git-commit', async (_event, { folder, message }) => {
  const add = await runGit(folder, 'add -A');
  if (!add.ok) return add;
  return runGit(folder, `commit -m "${message.replace(/"/g, '\\"')}"`);
});

ipcMain.handle('git-push', async (_event, { folder }) => {
  return runGit(folder, 'push -u origin HEAD');
});

// --- Deploy: run whatever script the user already uses (npm run deploy, a shell script, etc). ---
const deployProcesses = new Map();

ipcMain.handle('run-deploy', (_event, { id, folder, command }) => {
  if (deployProcesses.has(id)) return { ok: false, error: 'A deploy is already running.' };
  if (!fs.existsSync(folder)) return { ok: false, error: `Folder does not exist: ${folder}` };

  let child;
  try {
    child = spawn(command, { cwd: folder, shell: true });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  deployProcesses.set(id, child);

  child.stdout.on('data', (d) => mainWindow?.webContents.send('deploy-log', { id, text: d.toString() }));
  child.stderr.on('data', (d) => mainWindow?.webContents.send('deploy-log', { id, text: d.toString() }));
  child.on('close', (code) => {
    deployProcesses.delete(id);
    mainWindow?.webContents.send('deploy-closed', { id, code });
  });
  child.on('error', (err) => {
    deployProcesses.delete(id);
    mainWindow?.webContents.send('deploy-log', { id, text: `\n[error] ${err.message}\n` });
    mainWindow?.webContents.send('deploy-closed', { id, code: -1 });
  });

  return { ok: true };
});

// --- Feature planning: Claude proposes WHICH files to touch and how, but writes nothing. ---
ipcMain.handle('ai-plan-feature', async (_event, { folder, description }) => {
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'Folder not found.' };

  let pkg = '(no package.json found)';
  const pkgPath = path.join(folder, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try { pkg = fs.readFileSync(pkgPath, 'utf8'); } catch {}
  }
  const files = [];
  walkFiles(folder, '', files, 0);

  const prompt = constitutionPreamble(folder) + [
    'You are planning a feature implementation for an existing codebase. You will NOT write code yet —',
    'only produce a short plan of which files need to change or be created, and what each change does.',
    'Keep it to at most 6 files. Respond ONLY with a JSON array, no markdown fences, no other text:',
    '[{"file": "relative/path/from/project/root.ext", "change": "1-2 sentence description of what to do in this file"}]',
    'Use forward slashes in paths. For new files, still give a sensible relative path.',
    '',
    'package.json:',
    pkg,
    '',
    'Existing project files:',
    files.slice(0, 200).join('\n'),
    '',
    'FEATURE REQUEST:',
    description,
  ].join('\n');

  const result = await callClaude(prompt);
  if (!result.ok) return result;

  try {
    const cleaned = result.text.trim().replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '');
    const plan = JSON.parse(cleaned);
    return { ok: true, plan };
  } catch {
    return { ok: false, error: 'Claude did not return a parseable plan. Try rephrasing the feature request.' };
  }
});

// One plan item -> a proposed change for that one file, same shape as ai-propose-fix
// so the renderer can reuse the exact same review/approve panel.
ipcMain.handle('ai-propose-feature-file', async (_event, { folder, filePath, description, planContext }) => {
  let oldContent;
  try {
    oldContent = fs.readFileSync(filePath, 'utf8');
  } catch {
    oldContent = '';
  }

  const prompt = constitutionPreamble(folder) + [
    'You are implementing one part of a multi-file feature. You will be shown the overall feature request,',
    'the full plan across all files, and the current content of ONE specific file (empty if it is new).',
    'Respond in EXACTLY this format, nothing else:',
    'EXPLANATION:',
    '<1-3 sentence explanation of what you changed in this file>',
    '---NEWFILE---',
    '<the COMPLETE file content after your change, and nothing else after it>',
    '',
    `OVERALL FEATURE REQUEST: ${description}`,
    `FULL PLAN: ${JSON.stringify(planContext)}`,
    `THIS FILE'S PATH: ${filePath}`,
    'THIS FILE\'S CURRENT CONTENT (empty means create it new):',
    oldContent,
  ].join('\n');

  const result = await callClaude(prompt);
  if (!result.ok) return result;

  const marker = '---NEWFILE---';
  const idx = result.text.indexOf(marker);
  if (idx === -1) return { ok: false, error: 'AI response was not in the expected format. Try again.' };
  const explanation = result.text.slice('EXPLANATION:'.length, idx).trim();
  let newContent = result.text.slice(idx + marker.length);
  newContent = newContent.replace(/^\n/, '').replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '');

  return { ok: true, oldContent, newContent, explanation, filePath };
});

// =======================================================================
// Changelog: turns the explanations Bug Fix Assist / Feature Builder
// already generate into a dev-facing CHANGELOG.md entry and a plain-
// language release-notes.md entry. Advisory generation, explicit save —
// same pattern as everything else here.
// =======================================================================

ipcMain.handle('ai-generate-changelog', async (_event, { changes }) => {
  if (!changes || changes.length === 0) return { ok: false, error: 'No changes to summarize.' };

  const prompt = [
    'You are writing changelog entries for a set of already-approved code changes.',
    'Given the list of changes below (file touched + what changed), write TWO versions.',
    'Respond in EXACTLY this format, nothing else:',
    'DEV:',
    '<concise technical changelog entry, "Keep a Changelog" style bullet points, one per change, developer-facing, can mention file names>',
    '---USER---',
    '<short, friendly, plain-language release note for end users — no code or file names, describe what improved for them, 1-4 bullet points or short sentences>',
    '',
    'CHANGES:',
    JSON.stringify(changes, null, 2),
  ].join('\n');

  const result = await callClaude(prompt);
  if (!result.ok) return result;

  const marker = '---USER---';
  const idx2 = result.text.indexOf(marker);
  if (idx2 === -1) return { ok: false, error: 'AI response was not in the expected format. Try again.' };
  const devEntry = result.text.slice('DEV:'.length, idx2).trim();
  const userEntry = result.text.slice(idx2 + marker.length).trim();

  return { ok: true, devEntry, userEntry };
});

function prependChangelogEntry(filePath, defaultTitle, entryBody) {
  const dateHeader = `## ${new Date().toISOString().slice(0, 10)}`;
  const entry = `${dateHeader}\n\n${entryBody}\n\n`;

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# ${defaultTitle}\n\n${entry}`, 'utf8');
    return;
  }

  const existing = fs.readFileSync(filePath, 'utf8');
  const titleMatch = existing.match(/^#[^\n]*\n+/);
  if (titleMatch) {
    const insertAt = titleMatch[0].length;
    const updated = existing.slice(0, insertAt) + entry + existing.slice(insertAt);
    fs.writeFileSync(filePath, updated, 'utf8');
  } else {
    fs.writeFileSync(filePath, entry + existing, 'utf8');
  }
}

ipcMain.handle('append-changelog', (_event, { folder, devEntry, userEntry }) => {
  try {
    prependChangelogEntry(path.join(folder, 'CHANGELOG.md'), 'Changelog', devEntry);
    prependChangelogEntry(path.join(folder, 'release-notes.md'), 'Release Notes', userEntry);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// =======================================================================
// Project Config & Secrets
// Every project gets its own nexus.config.json (version + project_uid),
// stored IN the project folder (safe: no secrets in it, just an id).
// Actual secret values are never written to the project folder — they're
// encrypted with safeStorage and kept in Nexus's own userData config,
// namespaced by project_uid. This gives the "no plaintext, no bypass for
// missing UID" property the doc asked for, without adding a native
// dependency (keytar) that needs a Windows build toolchain to compile.
// =======================================================================

const CONFIG_SCHEMA_VERSION = 1;

function readProjectConfig(folder) {
  const configPath = path.join(folder, 'nexus.config.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!parsed.version || !parsed.project_uid) return null; // invalid — treat as missing
    return parsed;
  } catch {
    return null; // corrupt JSON — treat as missing, never load partial config
  }
}

// Validates and repairs (or creates) a project's config. Never proceeds
// with a partial/invalid config — always ends up with a fully valid one
// or reports the failure.
ipcMain.handle('ensure-project-config', (_event, { folder }) => {
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'Folder not found.' };

  let cfg = readProjectConfig(folder);
  let repaired = false;

  if (!cfg) {
    cfg = {
      version: CONFIG_SCHEMA_VERSION,
      project_uid: crypto.randomUUID(),
      credential_store_path: '(managed by Nexus, encrypted — not stored in this file)',
    };
    repaired = true;
  } else {
    // Validate mandatory fields individually; repair only what's missing,
    // never silently accept a config with a hole in it.
    if (cfg.version !== CONFIG_SCHEMA_VERSION) { cfg.version = CONFIG_SCHEMA_VERSION; repaired = true; }
    if (!cfg.project_uid) { cfg.project_uid = crypto.randomUUID(); repaired = true; }
    if (!cfg.credential_store_path) { cfg.credential_store_path = '(managed by Nexus, encrypted — not stored in this file)'; repaired = true; }
  }

  try {
    fs.writeFileSync(path.join(folder, 'nexus.config.json'), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    return { ok: false, error: `Could not write nexus.config.json: ${err.message}` };
  }

  return { ok: true, config: cfg, repaired };
});

function projectSecretsKey(projectUid) {
  return `projectSecrets.${projectUid}`;
}

ipcMain.handle('save-project-secret', (_event, { projectUid, key, value }) => {
  if (!projectUid) return { ok: false, error: 'Missing project_uid — refusing to store an unscoped secret.' };
  const cfg = loadConfig();
  const storeKey = projectSecretsKey(projectUid);
  const secrets = cfg[storeKey] || {};

  if (safeStorage.isEncryptionAvailable()) {
    secrets[key] = safeStorage.encryptString(value).toString('base64');
  } else {
    return { ok: false, error: 'OS-level encryption is unavailable on this machine — refusing to store in plaintext.' };
  }

  cfg[storeKey] = secrets;
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle('list-project-secrets', (_event, { projectUid }) => {
  if (!projectUid) return { ok: false, error: 'Missing project_uid.' };
  const cfg = loadConfig();
  const secrets = cfg[projectSecretsKey(projectUid)] || {};
  // Return keys only + a decrypted preview flag — never the raw encrypted blob to the renderer needlessly.
  return { ok: true, keys: Object.keys(secrets) };
});

ipcMain.handle('reveal-project-secret', (_event, { projectUid, key }) => {
  const cfg = loadConfig();
  const secrets = cfg[projectSecretsKey(projectUid)] || {};
  const encVal = secrets[key];
  if (!encVal) return { ok: false, error: 'Not found.' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Encryption unavailable on this machine.' };
  try {
    return { ok: true, value: safeStorage.decryptString(Buffer.from(encVal, 'base64')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('delete-project-secret', (_event, { projectUid, key }) => {
  const cfg = loadConfig();
  const storeKey = projectSecretsKey(projectUid);
  const secrets = cfg[storeKey] || {};
  delete secrets[key];
  cfg[storeKey] = secrets;
  saveConfig(cfg);
  return { ok: true };
});

// =======================================================================
// Services: a real process control plane for a project's own scrapers,
// databases, or background workers. No optimistic states — a service is
// only ever reported ONLINE after a real handshake succeeds. Anything
// else is IDLE, VERIFYING, or OFFLINE (with the actual error attached),
// and errors reset the state immediately rather than retrying silently.
// =======================================================================

const services = new Map(); // serviceKey ("projectId:serviceName") -> { child, state, lastError }

function serviceKey(projectId, name) {
  return `${projectId}:${name}`;
}

function setServiceState(key, state, extra = {}) {
  const entry = services.get(key) || {};
  services.set(key, { ...entry, state, ...extra, updatedAt: Date.now() });
  mainWindow?.webContents.send('service-state', { key, state, ...extra });
}

ipcMain.handle('start-service', async (_event, { projectId, name, folder, command, healthCheckUrl, projectUid }) => {
  const key = serviceKey(projectId, name);
  if (services.get(key)?.child) return { ok: false, error: 'Already running.' };
  if (!fs.existsSync(folder)) return { ok: false, error: `Folder does not exist: ${folder}` };

  setServiceState(key, 'VERIFYING');

  const secretsEnv = projectUid ? decryptAllProjectSecrets(projectUid) : {};

  let child;
  try {
    child = spawn(command, { cwd: folder, shell: true, env: { ...process.env, ...secretsEnv } });
  } catch (err) {
    setServiceState(key, 'IDLE', { lastError: err.message });
    return { ok: false, error: err.message };
  }

  services.set(key, { child, state: 'VERIFYING' });

  child.stdout.on('data', (d) => mainWindow?.webContents.send('service-log', { key, text: d.toString() }));
  child.stderr.on('data', (d) => mainWindow?.webContents.send('service-log', { key, text: d.toString() }));

  child.on('error', (err) => {
    services.delete(key);
    setServiceState(key, 'IDLE', { lastError: err.message });
  });
  child.on('close', (code) => {
    if (services.get(key)?.child === child) {
      services.delete(key);
      setServiceState(key, 'IDLE', { lastError: code !== 0 ? `Process exited with code ${code}` : null });
    }
  });

  if (!healthCheckUrl) {
    // No handshake configured — we can only honestly say the process is
    // running, NOT that the service inside it is actually ready. This is
    // reported as its own explicit state, not silently upgraded to ONLINE.
    setServiceState(key, 'RUNNING_UNVERIFIED', { note: 'No health check URL configured — cannot confirm readiness.' });
    return { ok: true };
  }

  // Real handshake: poll the health check URL for up to 15 seconds.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    if (!services.has(key)) return { ok: false, error: 'Process exited before it came online.' };
    try {
      const res = await fetch(healthCheckUrl, { method: 'GET' });
      if (res.ok) {
        setServiceState(key, 'ONLINE');
        return { ok: true };
      }
    } catch {
      // not up yet — keep polling
    }
  }

  setServiceState(key, 'OFFLINE', { lastError: 'Handshake timed out after 15s — health check never returned OK.' });
  return { ok: true }; // process may still be running; state accurately reflects it did not come online
});

ipcMain.handle('stop-service', (_event, { projectId, name }) => {
  const key = serviceKey(projectId, name);
  const entry = services.get(key);
  if (entry?.child) killProcessTree(entry.child);
  services.delete(key);
  setServiceState(key, 'IDLE');
  return { ok: true };
});

ipcMain.handle('get-service-state', (_event, { projectId, name }) => {
  const key = serviceKey(projectId, name);
  const entry = services.get(key);
  return entry ? { state: entry.state, lastError: entry.lastError || null } : { state: 'IDLE' };
});

// =======================================================================
// Audit -> Repair -> Test -> Gate pipeline. Runs on whichever folder the
// renderer points it at (a project, or Nexus's own folder before you
// build its installer). Every non-zero exit code is a real failure —
// nothing here is allowed to report success on a failing step.
// =======================================================================

function runCommandForPipeline(folder, cmd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd: folder, shell: true, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          exitCode: error ? (error.code ?? 1) : 0,
          output: ((stdout || '') + (stderr ? '\n' + stderr : '')).trim(),
        });
      });
  });
}

ipcMain.handle('run-audit', async (_event, { folder }) => {
  if (!fs.existsSync(path.join(folder, 'package.json'))) {
    return { ok: false, error: 'No package.json in this folder — nothing to audit.' };
  }
  return runCommandForPipeline(folder, 'npm audit');
});

ipcMain.handle('run-audit-fix', async (_event, { folder }) => {
  return runCommandForPipeline(folder, 'npm audit fix');
});

ipcMain.handle('run-tests', async (_event, { folder }) => {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
  } catch {
    return { ok: false, error: 'No readable package.json.' };
  }
  if (!pkg.scripts || !pkg.scripts.test || /no test specified/i.test(pkg.scripts.test)) {
    return { ok: true, skipped: true, output: 'No "test" script defined in package.json — skipping (not a failure).' };
  }
  return runCommandForPipeline(folder, 'npm test');
});

// =======================================================================
// Integration detection: read-only scan for what a project already uses,
// so Bug Fix Assist / Feature Builder have real context and you don't
// have to hunt through files to know what a project depends on.
// =======================================================================

const PACKAGE_INTEGRATION_MAP = {
  openai: 'OpenAI', 'openai-edge': 'OpenAI',
  '@anthropic-ai/sdk': 'Anthropic / Claude',
  '@google/generative-ai': 'Google Gemini',
  stripe: 'Stripe',
  firebase: 'Firebase', 'firebase-admin': 'Firebase Admin',
  '@supabase/supabase-js': 'Supabase',
  'aws-sdk': 'AWS', '@aws-sdk/client-s3': 'AWS',
  twilio: 'Twilio',
  '@sendgrid/mail': 'SendGrid',
  '@pinecone-database/pinecone': 'Pinecone',
  langchain: 'LangChain',
};

const ENV_INTEGRATION_PATTERNS = [
  [/OPENAI_API_KEY/i, 'OpenAI'],
  [/ANTHROPIC_API_KEY/i, 'Anthropic / Claude'],
  [/GEMINI_API_KEY|GOOGLE_GENERATIVE_AI_KEY/i, 'Google Gemini'],
  [/STRIPE_(SECRET|PUBLISHABLE)_KEY/i, 'Stripe'],
  [/FIREBASE_API_KEY/i, 'Firebase'],
  [/SUPABASE_(URL|ANON_KEY)/i, 'Supabase'],
  [/AWS_ACCESS_KEY_ID/i, 'AWS'],
  [/TWILIO_ACCOUNT_SID/i, 'Twilio'],
  [/SENDGRID_API_KEY/i, 'SendGrid'],
];

ipcMain.handle('scan-integrations', (_event, { folder }) => {
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'Folder not found.' };

  const findings = new Map(); // provider -> Set of evidence strings

  const pkgPath = path.join(folder, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const dep of Object.keys(deps)) {
        const provider = PACKAGE_INTEGRATION_MAP[dep];
        if (provider) {
          if (!findings.has(provider)) findings.set(provider, new Set());
          findings.get(provider).add(`dependency: "${dep}"`);
        }
      }
    } catch {}
  }

  const files = [];
  walkFiles(folder, '', files, 0);
  const relevant = files.filter((f) => /\.(js|jsx|ts|tsx|mjs|cjs|py|env)$/i.test(f) || /\.env/i.test(path.basename(f))).slice(0, 150);

  for (const rel of relevant) {
    const full = path.join(folder, rel);
    let content;
    try {
      const stat = fs.statSync(full);
      if (stat.size > 150 * 1024) continue;
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    for (const [regex, provider] of ENV_INTEGRATION_PATTERNS) {
      if (regex.test(content)) {
        if (!findings.has(provider)) findings.set(provider, new Set());
        const set = findings.get(provider);
        if (set.size < 5) set.add(`referenced in ${rel}`);
      }
    }
  }

  const integrations = Array.from(findings.entries()).map(([provider, evidence]) => ({
    provider,
    evidence: Array.from(evidence),
  }));
  return { ok: true, integrations };
});

// =======================================================================
// Bridging the encrypted secrets store to something a project's own code
// can actually read: either export as a real .env file, or (preferred)
// inject as real environment variables directly into a spawned process.
// =======================================================================

function decryptAllProjectSecrets(projectUid) {
  const cfg = loadConfig();
  const secrets = cfg[projectSecretsKey(projectUid)] || {};
  const out = {};
  if (!safeStorage.isEncryptionAvailable()) return out;
  for (const [key, encVal] of Object.entries(secrets)) {
    try {
      out[key] = safeStorage.decryptString(Buffer.from(encVal, 'base64'));
    } catch {
      // skip anything that fails to decrypt rather than crash the whole set
    }
  }
  return out;
}

ipcMain.handle('export-secrets-to-env', (_event, { folder, projectUid }) => {
  const secrets = decryptAllProjectSecrets(projectUid);
  const keys = Object.keys(secrets);
  if (keys.length === 0) return { ok: false, error: 'No secrets saved for this project yet.' };

  try {
    const envPath = path.join(folder, '.env');
    if (fs.existsSync(envPath)) fs.copyFileSync(envPath, envPath + '.bak');
    const content = keys.map((k) => `${k}=${secrets[k]}`).join('\n') + '\n';
    fs.writeFileSync(envPath, content, 'utf8');
    return { ok: true, count: keys.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

