// main.js — Electron "main process". This is the part that runs with full
// Node.js access: it can touch the real filesystem, spawn real processes,
// and make real network calls. The UI (renderer) never gets this power
// directly — it only talks to this file through the safe bridge in
// preload.js. That separation is what makes it safe to load web-ish UI code.

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn, execFile } = require('child_process');
const crypto = require('crypto');
const { resolveProjectPath } = require('./projectCloner');
const { getProjectsRoot } = require('./projectSettings');
const { saveProject } = require('./projectRegistry');
const { runPipeline, PipelineError } = require('./pipelineEngine');
const {
  sanitizeProjectFolderName,
  parseGeneratedFiles,
  detectStartCommand,
  escapeRegex,
  parseUnifiedDiff,
  parseJestStyleResults,
} = require('./pureLogic');
const { initUpdater, checkForUpdates, downloadUpdate, installUpdateAndRestart } = require('./updater');

// AI Improvement Framework - real, working modules for inventorying,
// measuring, testing, and safely upgrading the AI parts of whatever project
// is open. Every one of these operates on real files/processes for the
// active project folder; none of them fabricate data.
const aiInventory = require('./aiInventory');
const aiMetrics = require('./aiMetrics');
const aiGuardrailTester = require('./aiGuardrailTester');
const aiUpgradeOrchestrator = require('./aiUpgradeOrchestrator');
const promptTesting = require('./promptTesting');
const dependencyAuditor = require('./dependencyAuditor');
const complianceMonitor = require('./complianceMonitor');
const changelogGenerator = require('./changelogGenerator');
const knowledgeBase = require('./knowledgeBase');
const experimentationFramework = require('./experimentationFramework');

let mainWindow;

// --- Global error surfacing: previously an uncaught exception or rejected
// promise anywhere in the main process would fail silently - the app could
// freeze, or a background operation could just stop working, with no
// indication to the person using it that anything went wrong at all. These
// two handlers make sure every such error at least reaches the renderer as
// a visible notification, instead of vanishing into a terminal only a
// developer running from source would ever see. ---
process.on('uncaughtException', (err) => {
  console.error('[Nexus] Uncaught exception in main process:', err);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('main-process-error', { message: err.message, stack: err.stack });
  }
});
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : null;
  console.error('[Nexus] Unhandled rejection in main process:', reason);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('main-process-error', { message, stack });
  }
});

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
// Map of projectId -> Docker container name, only set for sandboxed
// launches (see launchProjectSandboxed) - lets stop-project issue a real
// `docker stop` instead of just killing the local `docker run` CLI process,
// which isn't guaranteed to stop the container itself.
const sandboxedContainers = new Map();

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
  // Electron normally syncs the window title to the page's own <title> tag
  // whenever it loads/changes. Since we set a real title (with build info)
  // ourselves after an async git lookup, that sync would otherwise race
  // against it and could silently overwrite our title back to the plain
  // <title> tag text depending on timing. Disabling the auto-sync makes our
  // explicit setTitle() call the only thing that ever sets the title.
  mainWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
  });
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

app.whenReady().then(async () => {
  createWindow();
  setupPreviewSession();
  setupPopupAllowlist();
  initUpdater(mainWindow);
  checkForUpdates().catch((err) => {
    console.error('Update check failed:', err.message);
  });

  const buildInfo = await computeBuildInfo();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (buildInfo.ok) {
      mainWindow.setTitle(`NEXUS — v${buildInfo.version} · build ${buildInfo.buildNumber} (${buildInfo.commitHash})`);
    } else if (buildInfo.version) {
      mainWindow.setTitle(`NEXUS — v${buildInfo.version}`);
    }
    // If neither is available, leave the default <title> from index.html.
  }
});

app.on('window-all-closed', () => {
  // Make sure we don't leave dev servers running as orphaned processes.
  for (const containerName of sandboxedContainers.values()) spawn('docker', ['stop', containerName]);
  for (const child of runningProcesses.values()) killProcessTree(child);
  for (const child of runningContainerLogs.values()) killProcessTree(child);
  for (const child of npmOperations.values()) killProcessTree(child);
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

// --- Backup/export of "my Nexus setup." Only the genuinely portable parts
// are included: project names, folders, commands, ports, deploy commands,
// and service definitions. Secrets are deliberately excluded - they're
// encrypted via Electron's safeStorage, which is tied to the Windows
// account that created them, and cannot be decrypted by a different
// account or machine. Pretending to export them would just produce a file
// that silently fails to restore anything useful; better to be upfront
// that secrets always need to be re-entered after an import. ---
ipcMain.handle('export-nexus-setup', async (_event, { projects }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Nexus Setup',
    defaultPath: `nexus-setup-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  const exportData = {
    exportedAt: new Date().toISOString(),
    note: 'Secrets are NOT included - they are encrypted per-Windows-account and cannot be moved. Re-enter them per project after importing.',
    projects: (projects || []).map((p) => ({
      name: p.name,
      folder: p.folder,
      command: p.command,
      port: p.port,
      deployCommand: p.deployCommand || '',
      services: p.services || [],
    })),
  };

  try {
    fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf8');
    return { ok: true, path: result.filePath, count: exportData.projects.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('import-nexus-setup', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Nexus Setup',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

  let data;
  try {
    data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
  } catch (err) {
    return { ok: false, error: `Could not read or parse that file: ${err.message}` };
  }

  if (!Array.isArray(data.projects)) {
    return { ok: false, error: 'That file does not look like a Nexus setup export (missing a "projects" array).' };
  }

  const validProjects = data.projects.filter((p) => p && typeof p === 'object' && p.name && p.folder);
  if (validProjects.length === 0) {
    return { ok: false, error: 'No valid projects found in that file.' };
  }

  return { ok: true, projects: validProjects, droppedCount: data.projects.length - validProjects.length };
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

// --- Create a brand-new project from a plain-language description.
// The model generates a complete, real starter file set (not placeholders) in
// a strict parseable format; every file gets genuinely written to disk in
// a fresh local folder. Nothing is silently dropped - if parsing fails, the
// raw response is returned so the failure is visible, not masked. ---
ipcMain.handle('generate-new-project', async (_event, { name, description }) => {
  if (!name || !name.trim()) return { ok: false, error: 'Project name is required.' };
  if (!description || !description.trim()) return { ok: false, error: 'Describe what the project should do.' };

  const projectsRoot = getProjectsRoot();
  const folderName = sanitizeProjectFolderName(name);
  const destPath = path.join(projectsRoot, folderName);

  if (fs.existsSync(destPath) && fs.readdirSync(destPath).length > 0) {
    return { ok: false, error: `A folder already exists at ${destPath} and isn't empty. Pick a different project name.` };
  }

  const prompt = [
    'Generate a complete, REAL, runnable starter project based on the description below.',
    'Respond with a series of files in EXACTLY this format, and nothing else outside it - no',
    'commentary before or after, no markdown code fences around the whole response:',
    '',
    '===FILE: relative/path/to/file.ext===',
    '<complete file content, nothing else>',
    '===END FILE===',
    '(repeat for every file)',
    '',
    'Requirements:',
    '- Pick whatever runtime/stack genuinely best fits the description if none is specified.',
    '- If it is a Node-based project, include a real package.json with a working "dev" or',
    '  "start" script that actually runs the app.',
    '- Include a short README.md explaining what was generated and how to run it.',
    '- Write real, working code - not empty placeholders or TODO stubs. Keep the file count',
    '  reasonable (a genuinely minimal but functional starter), but every file must be complete.',
    '- Do NOT include node_modules, package-lock.json, or any build/generated output.',
    '- Do NOT wrap individual file contents in markdown code fences (no ```).',
    '',
    `PROJECT NAME: ${name}`,
    `DESCRIPTION: ${description}`,
  ].join('\n');

  const result = await callNimForProjectGeneration(prompt);
  if (!result.ok) return result;

  const files = parseGeneratedFiles(result.text);
  if (files.length === 0) {
    return {
      ok: false,
      error: 'AI response was not in the expected file format - nothing was written.',
      raw: result.text,
    };
  }

  try {
    fs.mkdirSync(destPath, { recursive: true });
    for (const file of files) {
      const absPath = path.join(destPath, file.relPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, file.content, 'utf8');
    }
  } catch (err) {
    return { ok: false, error: `Failed writing generated files: ${err.message}` };
  }

  const suggestedCommand = detectStartCommand(files);
  saveProject({ localPath: destPath, name: name.trim() });

  return {
    ok: true,
    path: destPath,
    files: files.map((f) => f.relPath),
    suggestedCommand,
  };
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
async function checkDockerAvailable() {
  const result = await runCommand(process.cwd(), 'docker version --format "{{.Server.Version}}"');
  return result.ok;
}

// Runs the project's start command inside an ephemeral Docker container
// instead of directly on the host, so a project (including one an AI agent
// is generating/running code in) cannot read or write anything outside its
// own folder - not other projects, not Nexus's own installation, not the
// rest of the filesystem. The container only gets: the project folder
// (read-write), a separate named volume for node_modules (so a container
// built on Linux never collides with host-installed native binaries), and
// the one port the dev server needs published back to localhost so Preview
// keeps working exactly as it does for a non-sandboxed launch. Network
// access is left on by default (most `npm install`/dev servers need it);
// this is a real, meaningful boundary against a misbehaving or malicious
// project touching the host - it is not a hardened security sandbox against
// a determined container escape.
function launchProjectSandboxed(id, folder, command, port, secretsEnv) {
  return new Promise((resolve) => {
    const containerName = `nexus-sandbox-${id}`;
    const nodeModulesVolume = `nexus-sandbox-${id}-node-modules`;

    const envArgs = [];
    envArgs.push('-e', `PORT=${port || ''}`);
    for (const [key, value] of Object.entries(secretsEnv || {})) envArgs.push('-e', `${key}=${value}`);

    const portArgs = port ? ['-p', `${port}:${port}`] : [];

    const args = [
      'run', '--rm', '--name', containerName,
      '-v', `${folder}:/workspace`,
      '-v', `${nodeModulesVolume}:/workspace/node_modules`,
      '-w', '/workspace',
      ...envArgs,
      ...portArgs,
      'node:20',
      'sh', '-c', command,
    ];

    // Best-effort cleanup of a stale container from a previous crashed run
    // before starting a new one with the same name.
    spawn('docker', ['rm', '-f', containerName]).on('close', () => {
      let child;
      try {
        child = spawn('docker', args, { cwd: folder });
      } catch (err) {
        resolve({ ok: false, error: err.message });
        return;
      }

      runningProcesses.set(id, child);
      sandboxedContainers.set(id, containerName);

      child.stdout.on('data', (data) => mainWindow?.webContents.send('project-log', { id, text: data.toString() }));
      child.stderr.on('data', (data) => mainWindow?.webContents.send('project-log', { id, text: data.toString() }));
      child.on('close', (code) => {
        runningProcesses.delete(id);
        sandboxedContainers.delete(id);
        mainWindow?.webContents.send('project-closed', { id, code });
      });
      child.on('error', (err) => {
        runningProcesses.delete(id);
        sandboxedContainers.delete(id);
        mainWindow?.webContents.send('project-log', { id, text: `\n[error] ${err.message}\n` });
        mainWindow?.webContents.send('project-closed', { id, code: -1 });
      });

      resolve({ ok: true, sandboxed: true });
    });
  });
}

ipcMain.handle('launch-project', async (_event, { id, folder, command, port, projectUid, sandboxed }) => {
  if (runningProcesses.has(id)) {
    return { ok: false, error: 'Already running.' };
  }
  if (!fs.existsSync(folder)) {
    return { ok: false, error: `Folder does not exist: ${folder}` };
  }

  const secretsEnv = projectUid ? decryptAllProjectSecrets(projectUid) : {};

  if (sandboxed) {
    if (!(await checkDockerAvailable())) {
      return { ok: false, error: 'Sandboxed launch needs Docker installed and running (Docker Desktop). Uncheck "Sandboxed" to run directly instead.' };
    }
    return launchProjectSandboxed(id, folder, command, port, secretsEnv);
  }

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
  const containerName = sandboxedContainers.get(id);
  if (containerName) {
    // `docker stop` triggers container exit, which (via --rm) removes it and
    // closes the `docker run` client's stdout - the existing 'close' handler
    // does the runningProcesses/sandboxedContainers cleanup from there.
    spawn('docker', ['stop', containerName]);
  }
  const child = runningProcesses.get(id);
  if (child) {
    killProcessTree(child);
    runningProcesses.delete(id);
    sandboxedContainers.delete(id);
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

// --- NVIDIA NIM API key (hosted at build.nvidia.com): same encrypted-at-rest
// pattern as the Gemini key. This calls NVIDIA's hosted NIM endpoint, NOT a
// self-hosted container - self-hosting real NIM containers needs enterprise-
// tier GPU hardware (verified minimum ~30GB VRAM even for the most memory-
// efficient coding-relevant model) that a consumer GPU doesn't have. The
// hosted API is NVIDIA's own free/pay-as-you-go path that needs no local GPU
// at all. ---
ipcMain.handle('save-nim-key', (_event, { key }) => {
  const cfg = loadConfig();
  if (safeStorage.isEncryptionAvailable()) {
    cfg.nimKeyEnc = safeStorage.encryptString(key).toString('base64');
  } else {
    cfg.nimKeyPlain = key;
  }
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle('has-nim-key', () => {
  const cfg = loadConfig();
  return Boolean(cfg.nimKeyEnc || cfg.nimKeyPlain);
});

ipcMain.handle('clear-nim-key', () => {
  const cfg = loadConfig();
  delete cfg.nimKeyEnc;
  delete cfg.nimKeyPlain;
  saveConfig(cfg);
  return { ok: true };
});

function getNimKey() {
  const cfg = loadConfig();
  if (cfg.nimKeyEnc && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(cfg.nimKeyEnc, 'base64'));
  }
  return cfg.nimKeyPlain || null;
}

// NVIDIA's hosted NIM endpoint - OpenAI-compatible chat completions API.
// Model chosen: Qwen3-Coder-Next, NVIDIA's coding-focused hosted model, the
// most relevant available option for Nexus's use (bug fixes, feature
// generation, project scaffolding). Confirmed via NVIDIA's own current
// support-matrix and model catalog as of August 2026 - verify current
// availability/pricing at build.nvidia.com if this ever needs revisiting.
const NIM_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NIM_MODEL = 'qwen/qwen3-coder-next';

// --- Shared NIM call. Used by Bug Fix Assist and Feature Suggestions. ---
async function callNim(prompt) {
  const key = getNimKey();
  if (!key) return { ok: false, error: 'No NVIDIA NIM API key saved yet. Add one in the Cloud tab (get one free at build.nvidia.com).' };

  try {
    const res = await fetch(NIM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: NIM_MODEL,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    }
    const text = data?.choices?.[0]?.message?.content || '';
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Same as callNim, but with a much higher token ceiling - generating a
// whole starter project (multiple real files) needs far more room than a
// single bug-fix diff does.
async function callNimForProjectGeneration(prompt) {
  const key = getNimKey();
  if (!key) return { ok: false, error: 'No NVIDIA NIM API key saved yet. Add one in the Cloud tab (get one free at build.nvidia.com).' };

  try {
    const res = await fetch(NIM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: NIM_MODEL,
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    }
    const text = data?.choices?.[0]?.message?.content || '';
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

// --- Project-wide search & replace. Reuses the same walkFiles/IGNORED_DIRS
// logic as the file tree - searches real file contents on disk, not a
// cached index, so results always reflect the current state of the project.
const SEARCH_BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.mov', '.avi',
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.pdf', '.exe', '.dll', '.so', '.bin', '.wasm',
]);
const SEARCH_MAX_FILE_SIZE = 500 * 1024; // skip anything bigger than 500KB
const SEARCH_MAX_MATCHES = 500;
const SEARCH_MAX_PER_FILE = 50;

ipcMain.handle('search-project', (_event, { folder, query, caseSensitive }) => {
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'Folder not found.' };
  if (!query || !query.trim()) return { ok: false, error: 'Enter something to search for.' };

  const relFiles = [];
  walkFiles(folder, '', relFiles, 0);

  const pattern = new RegExp(escapeRegex(query), caseSensitive ? 'g' : 'gi');
  const matches = [];
  let truncated = false;

  for (const relPath of relFiles) {
    if (matches.length >= SEARCH_MAX_MATCHES) { truncated = true; break; }
    const ext = path.extname(relPath).toLowerCase();
    if (SEARCH_BINARY_EXTENSIONS.has(ext)) continue;

    const absPath = path.join(folder, relPath);
    let stat;
    try { stat = fs.statSync(absPath); } catch { continue; }
    if (stat.size > SEARCH_MAX_FILE_SIZE) continue;

    let content;
    try { content = fs.readFileSync(absPath, 'utf8'); } catch { continue; }
    if (!pattern.test(content)) continue;
    pattern.lastIndex = 0;

    const lines = content.split('\n');
    let perFileCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (perFileCount >= SEARCH_MAX_PER_FILE || matches.length >= SEARCH_MAX_MATCHES) break;
      if (pattern.test(lines[i])) {
        matches.push({
          relPath,
          lineNumber: i + 1,
          lineText: lines[i].length > 300 ? lines[i].slice(0, 300) + '…' : lines[i],
        });
        perFileCount++;
      }
      pattern.lastIndex = 0;
    }
  }

  return { ok: true, matches, truncated };
});

ipcMain.handle('replace-in-project', (_event, { folder, query, replacement, caseSensitive }) => {
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'Folder not found.' };
  if (!query || !query.trim()) return { ok: false, error: 'Enter something to search for.' };

  const relFiles = [];
  walkFiles(folder, '', relFiles, 0);

  const pattern = new RegExp(escapeRegex(query), caseSensitive ? 'g' : 'gi');
  const filesChanged = [];
  let totalOccurrences = 0;

  for (const relPath of relFiles) {
    const ext = path.extname(relPath).toLowerCase();
    if (SEARCH_BINARY_EXTENSIONS.has(ext)) continue;

    const absPath = path.join(folder, relPath);
    let stat;
    try { stat = fs.statSync(absPath); } catch { continue; }
    if (stat.size > SEARCH_MAX_FILE_SIZE) continue;

    let content;
    try { content = fs.readFileSync(absPath, 'utf8'); } catch { continue; }

    const occurrences = (content.match(pattern) || []).length;
    if (occurrences === 0) continue;

    const newContent = content.replace(pattern, replacement);
    try {
      fs.copyFileSync(absPath, absPath + '.bak');
      fs.writeFileSync(absPath, newContent, 'utf8');
      logChange({ filePath: absPath, backupPath: absPath + '.bak', source: `Search & Replace: "${query}" → "${replacement}"` });
      filesChanged.push(relPath);
      totalOccurrences += occurrences;
    } catch (err) {
      return { ok: false, error: `Failed writing ${relPath}: ${err.message}`, filesChangedSoFar: filesChanged };
    }
  }

  return { ok: true, filesChanged, totalOccurrences };
});

ipcMain.handle('get-app-dir', () => __dirname);

// --- Build number: the actual git commit count in Nexus's own repo, not a
// manually-maintained counter. Every real commit is a real build increment
// automatically - nothing to remember to bump, and it can never drift out
// of sync with what's actually been shipped. Falls back gracefully (shows
// just the package.json version) if this ever runs somewhere without a
// .git folder, e.g. a packaged build with .git excluded. Used both for the
// IPC call the renderer makes, and to set the real OS window title. ---
async function computeBuildInfo() {
  let version = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    version = pkg.version;
  } catch { /* ignore - version stays null */ }

  const countResult = await runGit(__dirname, 'rev-list --count HEAD');
  const hashResult = await runGit(__dirname, 'rev-parse --short HEAD');

  if (!countResult.ok || !hashResult.ok) {
    return { ok: false, version };
  }

  return {
    ok: true,
    version,
    buildNumber: parseInt(countResult.output, 10) || 0,
    commitHash: hashResult.output,
  };
}

ipcMain.handle('get-build-info', () => computeBuildInfo());

// =======================================================================
// Auto-sync from GitHub: replaces manually downloading and copying files
// into place. Checks Nexus's own repo (this app's own source folder) for
// new commits on the remote, and if found, does a real `git pull` here.
// This is a genuinely different thing from the electron-updater wiring
// earlier - that's for PACKAGED INSTALLER releases via GitHub Releases,
// a much heavier flow (bump version, build an installer, publish it).
// This works directly against the live source folder you're running via
// `npm start`, which is what you've actually been using this whole time.
// =======================================================================

ipcMain.handle('check-for-source-updates', async () => {
  const fetchResult = await runGit(__dirname, 'fetch origin');
  if (!fetchResult.ok) return { ok: false, error: fetchResult.output || 'git fetch failed - not a repo, or no network.' };

  const localResult = await runGit(__dirname, 'rev-parse HEAD');
  const remoteResult = await runGit(__dirname, 'rev-parse origin/main');
  if (!localResult.ok || !remoteResult.ok) {
    return { ok: false, error: 'Could not compare local and remote commits.' };
  }

  if (localResult.output === remoteResult.output) {
    return { ok: true, hasUpdate: false };
  }

  const countResult = await runGit(__dirname, 'rev-list --count HEAD..origin/main');
  const behindCount = parseInt(countResult.output, 10) || 0;

  // Surface what actually changed, not just "there's an update" - real
  // commit messages, so this isn't a mystery prompt.
  const logResult = await runGit(__dirname, 'log --pretty=format:"%s" HEAD..origin/main');
  const commitMessages = logResult.ok ? logResult.output.split('\n').filter(Boolean) : [];

  return { ok: true, hasUpdate: true, behindCount, commitMessages };
});

ipcMain.handle('pull-source-updates', async () => {
  // Refuse to pull over uncommitted local changes to Nexus's own source -
  // silently discarding someone's in-progress edit would be exactly the
  // kind of masked failure this app's own principles rule out.
  const statusResult = await runGit(__dirname, 'status --porcelain');
  if (statusResult.ok && statusResult.output.trim()) {
    return { ok: false, error: 'Nexus\'s own source has uncommitted local changes. Commit or discard them first (Ship tab), then try again - pulling now could conflict with your changes.' };
  }

  const pullResult = await runGit(__dirname, 'pull origin main');
  if (!pullResult.ok) {
    return { ok: false, error: pullResult.output || 'git pull failed.' };
  }

  return { ok: true, output: pullResult.output };
});

ipcMain.handle('restart-nexus', () => {
  app.relaunch();
  app.exit(0);
});

// --- Sandboxed object pipeline (PowerShell-inspired). Real data in, real
// data out - the interpreter itself never touches fs/child_process/network
// (see pipelineEngine.js's own header comment and its self-verifying test
// for why). Context data is gathered here in main.js from Nexus's own
// already-real, already-reviewed data sources before being handed to the
// pure interpreter. ---
ipcMain.handle('run-pipeline-query', (_event, { input, context }) => {
  try {
    const data = runPipeline(input, context);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof PipelineError) return { ok: false, error: err.message };
    return { ok: false, error: `Unexpected error: ${err.message}` };
  }
});

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

  const result = await callNim(prompt);
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

// General-purpose prompt-driven coding, for the Code Editor's built-in
// prompt bar. Same before/after/approve shape as ai-propose-fix, but framed
// as a neutral coding instruction rather than specifically "fix this bug" -
// used for adding features, refactors, or writing brand-new files within
// an existing project, not just fixing errors. filePath may not exist yet
// (creating a new file) - handled the same way ai-propose-fix does.
ipcMain.handle('ai-edit-file-with-prompt', async (_event, { filePath, instruction, folder }) => {
  let editOldContent;
  try {
    editOldContent = fs.readFileSync(filePath, 'utf8');
  } catch {
    editOldContent = ''; // file doesn't exist yet — treat as "create this new file"
  }

  const editPrompt = constitutionPreamble(folder) + [
    'You are a careful coding assistant working inside a real code editor. You will be shown a',
    'file (which may be empty, meaning it does not exist yet and should be created) and an',
    'instruction describing what to write or change.',
    'Respond in EXACTLY this format, nothing else:',
    'EXPLANATION:',
    '<1-3 sentence plain-English explanation of what you wrote or changed>',
    '---NEWFILE---',
    '<the COMPLETE resulting file content, and nothing else after it>',
    '',
    `FILE PATH: ${filePath}`,
    'CURRENT FILE CONTENT (empty means the file does not exist yet):',
    editOldContent,
    '',
    'INSTRUCTION:',
    instruction,
  ].join('\n');

  const editResult = await callNim(editPrompt);
  if (!editResult.ok) return editResult;

  const editMarker = '---NEWFILE---';
  const editIdx = editResult.text.indexOf(editMarker);
  if (editIdx === -1) {
    return { ok: false, error: 'AI response was not in the expected format. Try again.', raw: editResult.text };
  }
  const editExplanation = editResult.text.slice('EXPLANATION:'.length, editIdx).trim();
  let editNewContent = editResult.text.slice(editIdx + editMarker.length);
  editNewContent = editNewContent.replace(/^\n/, '').replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '');

  return { ok: true, oldContent: editOldContent, newContent: editNewContent, explanation: editExplanation, filePath };
});

// =======================================================================
// Central "recent changes" log with one-click revert. Every write that
// already creates a .bak (apply-file-change, replace-in-project, and now
// format-and-lint-file below - which previously did NOT back up before
// running Prettier/ESLint --fix, a real gap closed as part of this) gets
// recorded here, so there's one place to see recent writes across a whole
// session and revert any of them without hunting for the matching .bak
// file on disk yourself.
// =======================================================================

const RECENT_CHANGES_LOG_PATH = path.join(app.getPath('userData'), 'nexus-recent-changes.json');
const RECENT_CHANGES_MAX = 200;

function loadRecentChanges() {
  try {
    return JSON.parse(fs.readFileSync(RECENT_CHANGES_LOG_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function logChange({ filePath, backupPath, source }) {
  if (!backupPath) return; // nothing to offer reverting to
  const log = loadRecentChanges();
  log.unshift({ filePath, backupPath, source: source || 'File change', timestamp: Date.now() });
  const trimmed = log.slice(0, RECENT_CHANGES_MAX);
  try {
    fs.writeFileSync(RECENT_CHANGES_LOG_PATH, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (err) {
    console.error('[Nexus] Could not write recent-changes log:', err.message);
  }
}

ipcMain.handle('get-recent-changes', () => ({ ok: true, changes: loadRecentChanges() }));

ipcMain.handle('revert-change', (_event, { filePath, backupPath }) => {
  if (!fs.existsSync(backupPath)) {
    return { ok: false, error: 'The backup file no longer exists on disk - it may have been cleaned up or already reverted.' };
  }
  try {
    fs.copyFileSync(backupPath, filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// The ONLY place a write happens. Always backs up first (if the file already exists).
ipcMain.handle('apply-file-change', (_event, { filePath, newContent, source }) => {
  try {
    let backupPath = null;
    if (fs.existsSync(filePath)) {
      backupPath = filePath + '.bak';
      fs.copyFileSync(filePath, backupPath);
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    fs.writeFileSync(filePath, newContent, 'utf8');
    logChange({ filePath, backupPath, source });
    return { ok: true, backupPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- Linting/formatting on save: always runs the PROJECT'S OWN installed
// ESLint/Prettier (from its own node_modules) - never a version bundled
// with Nexus. Different projects use different configs and rule sets;
// using Nexus's own copy would silently apply the wrong rules. If a
// project hasn't installed these tools, the corresponding feature is
// simply unavailable for it - never faked or skipped silently without
// telling you. ---
function findLocalBin(folder, name) {
  const binName = process.platform === 'win32' ? `${name}.cmd` : name;
  const binPath = path.join(folder, 'node_modules', '.bin', binName);
  return fs.existsSync(binPath) ? binPath : null;
}

function runCommand(cwd, command) {
  return new Promise((resolve) => {
    exec(command, { cwd, shell: true, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout || '', stderr: stderr || '', error: error ? error.message : null });
    });
  });
}

// Same as runCommand, but takes the binary and its arguments as a real
// argv array and never goes through a shell. Use this instead of runCommand
// whenever any part of the command line comes from user-controlled input
// (e.g. a test name pattern) - string-building a shell command from
// untrusted text is a command-injection risk no amount of quote-escaping
// fully closes (CodeQL: "Incomplete string escaping or encoding").
function runCommandArgs(cwd, bin, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = execFile(bin, args, { cwd, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (error) => {
        resolve({ ok: !error, stdout, stderr, error: error ? error.message : null });
      });
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: '', error: err.message });
      return;
    }
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
  });
}

ipcMain.handle('detect-lint-tools', (_event, { folder }) => {
  if (!folder || !fs.existsSync(folder)) return { hasEslint: false, hasPrettier: false };
  return {
    hasEslint: !!findLocalBin(folder, 'eslint'),
    hasPrettier: !!findLocalBin(folder, 'prettier'),
  };
});

ipcMain.handle('format-and-lint-file', async (_event, { folder, filePath }) => {
  if (!fs.existsSync(filePath)) return { ok: false, error: 'File does not exist yet - save it first.' };

  const prettierBin = findLocalBin(folder, 'prettier');
  const eslintBin = findLocalBin(folder, 'eslint');

  if (!prettierBin && !eslintBin) {
    return { ok: false, error: 'Neither Prettier nor ESLint is installed in this project (checked node_modules/.bin).' };
  }

  // Prettier --write and ESLint --fix both modify the file in place on
  // disk directly - back it up first, same as every other write in Nexus,
  // so a bad auto-format is always one revert away.
  const backupPath = filePath + '.bak';
  try {
    fs.copyFileSync(filePath, backupPath);
  } catch (err) {
    return { ok: false, error: `Could not create backup before formatting: ${err.message}` };
  }

  let formatted = false;
  if (prettierBin) {
    const result = await runCommand(folder, `"${prettierBin}" --write "${filePath}"`);
    formatted = result.ok;
  }

  let fixed = false;
  let lintMessages = [];
  if (eslintBin) {
    // --fix first (auto-fixable issues), then a plain pass to report
    // whatever's left that couldn't be auto-fixed.
    const fixResult = await runCommand(folder, `"${eslintBin}" --fix "${filePath}"`);
    fixed = fixResult.ok;

    const reportResult = await runCommand(folder, `"${eslintBin}" --format json "${filePath}"`);
    try {
      const parsed = JSON.parse(reportResult.stdout || '[]');
      lintMessages = (parsed[0]?.messages || []).map((m) => ({
        line: m.line || 0,
        message: m.message,
        ruleId: m.ruleId || '',
        severity: m.severity === 2 ? 'error' : 'warning',
      }));
    } catch {
      // ESLint failed to run at all (e.g. no config present) - surface
      // the raw error rather than silently reporting zero issues.
      if (!reportResult.ok && reportResult.stderr) {
        return { ok: false, error: `ESLint error: ${reportResult.stderr.trim()}` };
      }
    }
  }

  let newContent;
  try {
    newContent = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { ok: false, error: err.message };
  }

  logChange({ filePath, backupPath, source: 'Format/Lint (Prettier/ESLint)' });

  return { ok: true, newContent, formatted, fixed, lintMessages, hasEslint: !!eslintBin, hasPrettier: !!prettierBin, backupPath };
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

  const result = await callNim(prompt);
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

// Same as runGit, but for call sites that carry free-typed user input
// (a commit message, a branch name). Passes a real argv array straight to
// git with no shell involved, so there is nothing to escape and nothing to
// inject - fixes CodeQL "Incomplete string escaping or encoding" for
// git-commit, and closes the same (previously unflagged) hole in
// git-create-branch, which interpolated branchName with no escaping at all.
function runGitArgs(folder, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: folder, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
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

// --- Real git diff viewer: parses unified diff output into structured
// per-file hunks (added/removed/context lines) instead of showing raw text.
// Untracked files don't appear in `git diff` at all, so those are handled
// separately - their whole content is shown as one big "addition" hunk. ---
ipcMain.handle('git-diff', async (_event, { folder }) => {
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'Folder not found.' };

  const statusResult = await runGit(folder, 'status --porcelain');
  if (!statusResult.ok) return { ok: false, error: statusResult.output || 'Not a git repository.' };

  const statusLines = statusResult.output.split('\n').filter(Boolean);
  const statusByPath = {};
  const untrackedPaths = [];
  for (const line of statusLines) {
    const code = line.slice(0, 2).trim();
    const relPath = line.slice(3).trim();
    statusByPath[relPath] = code;
    if (code === '??') untrackedPaths.push(relPath);
  }

  const diffResult = await runGit(folder, 'diff HEAD --unified=3');
  const trackedFiles = diffResult.ok ? parseUnifiedDiff(diffResult.output) : [];
  for (const f of trackedFiles) {
    f.status = statusByPath[f.relPath] || 'M';
  }

  for (const relPath of untrackedPaths) {
    const absPath = path.join(folder, relPath);
    const ext = path.extname(relPath).toLowerCase();
    if (SEARCH_BINARY_EXTENSIONS.has(ext)) {
      trackedFiles.push({ relPath, status: '??', hunks: [{ header: '(binary file)', lines: [] }] });
      continue;
    }
    let stat;
    try { stat = fs.statSync(absPath); } catch { continue; }
    if (stat.size > SEARCH_MAX_FILE_SIZE) {
      trackedFiles.push({ relPath, status: '??', hunks: [{ header: '(file too large to preview)', lines: [] }] });
      continue;
    }
    let content;
    try { content = fs.readFileSync(absPath, 'utf8'); } catch { continue; }
    trackedFiles.push({
      relPath,
      status: '??',
      hunks: [{
        header: 'New file',
        lines: content.split('\n').map((text) => ({ type: 'add', text })),
      }],
    });
  }

  return { ok: true, files: trackedFiles };
});

// --- Commit history / branch viewer. Real git log data - hashes, authors,
// dates, messages - plus which branches point at which commits. Clicking a
// commit shows its actual diff, reusing the same parser as the working-tree
// diff viewer above. ---
ipcMain.handle('git-log', async (_event, { folder, limit }) => {
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'Folder not found.' };

  const logResult = await runGit(folder, `log --pretty=format:"%H|||%an|||%ad|||%s" --date=short -n ${limit || 50}`);
  if (!logResult.ok) return { ok: false, error: logResult.output || 'Not a git repository, or no commits yet.' };

  const commits = logResult.output.split('\n').filter(Boolean).map((line) => {
    const [hash, author, date, ...msgParts] = line.split('|||');
    return { hash, shortHash: hash.slice(0, 7), author, date, message: msgParts.join('|||'), branches: [] };
  });

  const branchResult = await runGit(folder, `for-each-ref --format="%(refname:short)|||%(objectname)" refs/heads refs/remotes`);
  if (branchResult.ok) {
    const branchMap = {};
    for (const line of branchResult.output.split('\n').filter(Boolean)) {
      const [branchName, commitHash] = line.split('|||');
      if (!branchMap[commitHash]) branchMap[commitHash] = [];
      branchMap[commitHash].push(branchName);
    }
    for (const c of commits) {
      c.branches = branchMap[c.hash] || [];
    }
  }

  return { ok: true, commits };
});

ipcMain.handle('git-show-commit', async (_event, { folder, hash }) => {
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'Folder not found.' };
  const result = await runGit(folder, `show ${hash} --unified=3 --pretty=format:""`);
  if (!result.ok) return { ok: false, error: result.output };
  const files = parseUnifiedDiff(result.output);
  return { ok: true, files };
});

ipcMain.handle('git-create-branch', async (_event, { folder, branchName }) => {
  return runGitArgs(folder, ['checkout', '-b', branchName]);
});

ipcMain.handle('git-commit', async (_event, { folder, message }) => {
  const add = await runGit(folder, 'add -A');
  if (!add.ok) return add;
  return runGitArgs(folder, ['commit', '-m', message]);
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

// --- Feature planning: the model proposes WHICH files to touch and how, but writes nothing. ---
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

  const result = await callNim(prompt);
  if (!result.ok) return result;

  try {
    const cleaned = result.text.trim().replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '');
    const plan = JSON.parse(cleaned);
    return { ok: true, plan };
  } catch {
    return { ok: false, error: 'The model did not return a parseable plan. Try rephrasing the feature request.' };
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

  const result = await callNim(prompt);
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

  const result = await callNim(prompt);
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

// --- Real per-test results, not just overall pass/fail. Only Jest and
// Vitest are supported with structured results (their JSON reporters are
// close enough in shape to parse with one function) - any other test
// runner falls back to the plain npm-test output above rather than
// pretending to show per-test detail it doesn't actually have. ---
function detectTestFramework(folder) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.vitest) return 'vitest';
  if (deps.jest) return 'jest';
  return null;
}

ipcMain.handle('detect-test-framework', (_event, { folder }) => {
  return { framework: detectTestFramework(folder) };
});

ipcMain.handle('run-tests-detailed', async (_event, { folder, testNamePattern }) => {
  const framework = detectTestFramework(folder);
  if (!framework) {
    // Honest fallback - no structured per-test data available, but still
    // give real output rather than a dead end.
    const plain = await runCommandForPipeline(folder, 'npm test');
    return { ok: plain.ok, detailed: false, output: plain.output, error: plain.ok ? null : 'No supported test framework (Jest or Vitest) detected - showing plain output instead.' };
  }

  const bin = findLocalBin(folder, framework) || framework; // fall back to PATH/npx resolution if not locally installed
  const outFile = path.join(os.tmpdir(), `nexus-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  // Built as a real argv array (no shell) so a test name pattern can never
  // be interpreted as shell syntax, regardless of what characters it
  // contains - see runCommandArgs above.
  let args;
  if (framework === 'jest') {
    args = ['--json', `--outputFile=${outFile}`];
  } else {
    args = ['run', '--reporter=json', `--outputFile=${outFile}`];
  }
  if (testNamePattern) args.push('-t', testNamePattern);

  const runResult = await runCommandArgs(folder, bin, args);

  let parsed = null;
  try {
    const jsonText = fs.readFileSync(outFile, 'utf8');
    parsed = parseJestStyleResults(jsonText);
  } catch (err) {
    // The framework ran but we couldn't parse structured output - surface
    // the raw command output rather than showing nothing.
    return { ok: runResult.ok, detailed: false, output: runResult.stdout + '\n' + runResult.stderr, error: `Could not parse ${framework} JSON output: ${err.message}` };
  } finally {
    try { fs.unlinkSync(outFile); } catch { /* best effort cleanup */ }
  }

  return { ok: runResult.ok, detailed: true, framework, ...parsed };
});

// =======================================================================
// API Testing Tool: sends real HTTP requests from the main process (avoids
// any renderer CORS restriction), and persists a real per-project request
// collection to a JSON file - not an in-memory-only "session" that vanishes
// on restart.
// =======================================================================

const API_COLLECTION_FILENAME = '.nexus-api-requests.json';

ipcMain.handle('api-send-request', async (_event, { method, url, headersText, body }) => {
  if (!url || !url.trim()) return { ok: false, error: 'Enter a URL.' };

  const headers = {};
  for (const line of (headersText || '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }

  const startTime = Date.now();
  try {
    const fetchOptions = { method: method || 'GET', headers };
    if (body && !['GET', 'HEAD'].includes((method || 'GET').toUpperCase())) {
      fetchOptions.body = body;
    }
    const res = await fetch(url, fetchOptions);
    const timeMs = Date.now() - startTime;
    const responseText = await res.text();
    const responseHeaders = {};
    res.headers.forEach((value, key) => { responseHeaders[key] = value; });

    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      body: responseText,
      timeMs,
    };
  } catch (err) {
    return { ok: false, error: err.message, timeMs: Date.now() - startTime };
  }
});

ipcMain.handle('api-load-collection', (_event, { folder }) => {
  if (!folder) return { ok: true, requests: [] };
  const filePath = path.join(folder, API_COLLECTION_FILENAME);
  if (!fs.existsSync(filePath)) return { ok: true, requests: [] };
  try {
    const requests = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ok: true, requests: Array.isArray(requests) ? requests : [] };
  } catch (err) {
    return { ok: false, error: `Could not read ${API_COLLECTION_FILENAME}: ${err.message}` };
  }
});

ipcMain.handle('api-save-collection', (_event, { folder, requests }) => {
  if (!folder) return { ok: false, error: 'No active project.' };
  try {
    fs.writeFileSync(path.join(folder, API_COLLECTION_FILENAME), JSON.stringify(requests, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// =======================================================================
// Docker integration: build/run/stop/inspect real containers. Every action
// shells out to the user's own installed `docker` binary - Nexus doesn't
// bundle or fake any part of Docker itself. If Docker isn't installed or
// the daemon isn't running, that's reported plainly, not silently skipped.
// =======================================================================

const runningContainerLogs = new Map(); // containerName -> spawned `docker logs -f` process

ipcMain.handle('docker-check', async () => {
  const result = await runCommand(process.cwd(), 'docker version --format "{{.Server.Version}}"');
  if (!result.ok) {
    // Distinguish "not installed" from "installed but daemon not running"
    // by checking whether the client version alone is reachable.
    const clientCheck = await runCommand(process.cwd(), 'docker version --format "{{.Client.Version}}"');
    if (!clientCheck.ok) return { installed: false, running: false };
    return { installed: true, running: false };
  }
  return { installed: true, running: true, version: result.stdout.trim() };
});

ipcMain.handle('docker-detect-project', (_event, { folder }) => {
  if (!folder) return { hasDockerfile: false, hasCompose: false };
  return {
    hasDockerfile: fs.existsSync(path.join(folder, 'Dockerfile')),
    hasCompose: fs.existsSync(path.join(folder, 'docker-compose.yml')) || fs.existsSync(path.join(folder, 'docker-compose.yaml')),
  };
});

ipcMain.handle('docker-build', (_event, { folder, tag }) => {
  if (!fs.existsSync(path.join(folder, 'Dockerfile'))) {
    return { ok: false, error: 'No Dockerfile found in this project.' };
  }
  let child;
  try {
    child = spawn('docker', ['build', '-t', tag, '.'], { cwd: folder, shell: true });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  child.stdout.on('data', (data) => mainWindow?.webContents.send('docker-build-log', { text: data.toString() }));
  child.stderr.on('data', (data) => mainWindow?.webContents.send('docker-build-log', { text: data.toString() }));
  child.on('close', (code) => mainWindow?.webContents.send('docker-build-done', { ok: code === 0, code }));
  child.on('error', (err) => mainWindow?.webContents.send('docker-build-log', { text: `\n[error] ${err.message}\n` }));

  return { ok: true };
});

ipcMain.handle('docker-run', async (_event, { image, containerName, hostPort, containerPort }) => {
  const portArgs = hostPort && containerPort ? ['-p', `${hostPort}:${containerPort}`] : [];
  const args = ['run', '-d', '--name', containerName, ...portArgs, image];
  const result = await runCommand(process.cwd(), `docker ${args.map((a) => `"${a}"`).join(' ')}`);
  if (!result.ok) return { ok: false, error: result.stderr.trim() || result.error };
  return { ok: true, containerId: result.stdout.trim() };
});

ipcMain.handle('docker-stop', async (_event, { containerName }) => {
  const result = await runCommand(process.cwd(), `docker stop "${containerName}"`);
  return { ok: result.ok, error: result.ok ? null : result.stderr.trim() };
});

ipcMain.handle('docker-remove', async (_event, { containerName }) => {
  const result = await runCommand(process.cwd(), `docker rm -f "${containerName}"`);
  return { ok: result.ok, error: result.ok ? null : result.stderr.trim() };
});

ipcMain.handle('docker-ps', async () => {
  const result = await runCommand(process.cwd(), 'docker ps -a --format "{{.ID}}|||{{.Image}}|||{{.Names}}|||{{.Status}}|||{{.Ports}}"');
  if (!result.ok) return { ok: false, error: result.stderr.trim() || result.error };
  const containers = result.stdout.split('\n').filter(Boolean).map((line) => {
    const [id, image, names, status, ports] = line.split('|||');
    return { id, image, names, status, ports: ports || '' };
  });
  return { ok: true, containers };
});

ipcMain.handle('docker-stream-logs', (_event, { containerName }) => {
  if (runningContainerLogs.has(containerName)) return { ok: true }; // already streaming
  let child;
  try {
    child = spawn('docker', ['logs', '-f', '--tail', '100', containerName], { shell: true });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  runningContainerLogs.set(containerName, child);
  child.stdout.on('data', (data) => mainWindow?.webContents.send('docker-container-log', { containerName, text: data.toString() }));
  child.stderr.on('data', (data) => mainWindow?.webContents.send('docker-container-log', { containerName, text: data.toString() }));
  child.on('close', () => runningContainerLogs.delete(containerName));
  return { ok: true };
});

ipcMain.handle('docker-stop-log-stream', (_event, { containerName }) => {
  const child = runningContainerLogs.get(containerName);
  if (child) { killProcessTree(child); runningContainerLogs.delete(containerName); }
  return { ok: true };
});

// =======================================================================
// Package Manager UI: real npm commands against the active project's own
// package.json/node_modules. Installed-version data comes from actually
// reading node_modules/<pkg>/package.json, not just trusting whatever
// range is written in package.json - those can differ.
// =======================================================================

const npmOperations = new Map(); // arbitrary op id -> spawned child, for streaming

ipcMain.handle('npm-list-deps', (_event, { folder }) => {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
  } catch (err) {
    return { ok: false, error: `Could not read package.json: ${err.message}` };
  }

  const deps = [];
  for (const [name, wantedVersion] of Object.entries(pkg.dependencies || {})) {
    deps.push({ name, wantedVersion, dev: false, installedVersion: readInstalledVersion(folder, name) });
  }
  for (const [name, wantedVersion] of Object.entries(pkg.devDependencies || {})) {
    deps.push({ name, wantedVersion, dev: true, installedVersion: readInstalledVersion(folder, name) });
  }
  deps.sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, deps };
});

function readInstalledVersion(folder, packageName) {
  try {
    const pkgPath = path.join(folder, 'node_modules', packageName, 'package.json');
    const installed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return installed.version || null;
  } catch {
    return null; // not installed
  }
}

ipcMain.handle('npm-check-outdated', async (_event, { folder }) => {
  // npm outdated intentionally exits with a non-zero code when outdated
  // packages exist - that's normal, not a failure, so read stdout either way.
  const result = await runCommand(folder, 'npm outdated --json');
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    return { ok: true, outdated: parsed };
  } catch {
    // No output at all usually means nothing is outdated.
    return { ok: true, outdated: {} };
  }
});

function runNpmStreamed(opId, folder, args) {
  let child;
  try {
    child = spawn('npm', args, { cwd: folder, shell: true });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  npmOperations.set(opId, child);
  child.stdout.on('data', (data) => mainWindow?.webContents.send('npm-op-log', { opId, text: data.toString() }));
  child.stderr.on('data', (data) => mainWindow?.webContents.send('npm-op-log', { opId, text: data.toString() }));
  child.on('close', (code) => {
    npmOperations.delete(opId);
    mainWindow?.webContents.send('npm-op-done', { opId, ok: code === 0, code });
  });
  child.on('error', (err) => {
    npmOperations.delete(opId);
    mainWindow?.webContents.send('npm-op-log', { opId, text: `\n[error] ${err.message}\n` });
    mainWindow?.webContents.send('npm-op-done', { opId, ok: false, code: -1 });
  });
  return { ok: true };
}

ipcMain.handle('npm-install-package', (_event, { opId, folder, packageName, version, isDev }) => {
  const spec = version ? `${packageName}@${version}` : packageName;
  const args = ['install', spec, isDev ? '--save-dev' : '--save'];
  return runNpmStreamed(opId, folder, args);
});

ipcMain.handle('npm-uninstall-package', (_event, { opId, folder, packageName }) => {
  return runNpmStreamed(opId, folder, ['uninstall', packageName]);
});

ipcMain.handle('npm-update-package', (_event, { opId, folder, packageName }) => {
  return runNpmStreamed(opId, folder, ['update', packageName]);
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
// GitHub personal access token: same encrypted-at-rest pattern as the
// Gemini/NIM keys (see save-gemini-key above) - never stored in plaintext
// when OS-level encryption is available.
ipcMain.handle('save-github-token', (_event, { token }) => {
  const cfg = loadConfig();
  if (safeStorage.isEncryptionAvailable()) {
    cfg.githubTokenEnc = safeStorage.encryptString(token).toString('base64');
  } else {
    cfg.githubTokenPlain = token;
  }
  delete cfg.githubToken; // drop any older plaintext value from before this was encrypted
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle('has-github-token', () => Boolean(getGithubToken()));

ipcMain.handle('clear-github-token', () => {
  const cfg = loadConfig();
  delete cfg.githubToken;
  delete cfg.githubTokenEnc;
  delete cfg.githubTokenPlain;
  saveConfig(cfg);
  return { ok: true };
});

function getGithubToken() {
  const cfg = loadConfig();
  if (cfg.githubTokenEnc && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(cfg.githubTokenEnc, 'base64'));
  }
  return cfg.githubTokenPlain || cfg.githubToken || null;
}

// All seven of these call the real GitHub REST API via githubClient.js,
// using the token saved through save-github-token above. Each fails fast
// and clearly if nothing is connected yet, rather than making a request
// that GitHub would just reject.
const NOT_CONNECTED_ERROR = 'No GitHub token saved - connect GitHub in the Config tab first.';

ipcMain.handle('github-list-repos', async () => {
  const token = getGithubToken();
  if (!token) return { ok: false, error: NOT_CONNECTED_ERROR };
  const { listRepos } = require('./githubClient');
  try {
    return { ok: true, repos: await listRepos(token) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('github-get-file', async (_event, { owner, repo, path, ref }) => {
  const token = getGithubToken();
  if (!token) return { ok: false, error: NOT_CONNECTED_ERROR };
  const { getFileContent } = require('./githubClient');
  try {
    const result = await getFileContent(token, owner, repo, path, ref);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('github-put-file', async (_event, { owner, repo, path, content, message, branch, sha }) => {
  const token = getGithubToken();
  if (!token) return { ok: false, error: NOT_CONNECTED_ERROR };
  const { createOrUpdateFile } = require('./githubClient');
  try {
    const result = await createOrUpdateFile(token, owner, repo, path, content, message, branch, sha);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('github-create-pr', async (_event, { owner, repo, title, body, head, base }) => {
  const token = getGithubToken();
  if (!token) return { ok: false, error: NOT_CONNECTED_ERROR };
  const { createPullRequest } = require('./githubClient');
  try {
    const result = await createPullRequest(token, owner, repo, title, body, head, base);
    return { ok: true, pr: result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('github-list-prs', async (_event, { owner, repo, state }) => {
  const token = getGithubToken();
  if (!token) return { ok: false, error: NOT_CONNECTED_ERROR };
  const { getPullRequests } = require('./githubClient');
  try {
    const prs = await getPullRequests(token, owner, repo, state);
    return { ok: true, prs };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('github-create-branch', async (_event, { owner, repo, branch, fromBranch }) => {
  const token = getGithubToken();
  if (!token) return { ok: false, error: NOT_CONNECTED_ERROR };
  const { createBranch } = require('./githubClient');
  try {
    const result = await createBranch(token, owner, repo, branch, fromBranch);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('github-get-commits', async (_event, { owner, repo, branch, per_page }) => {
  const token = getGithubToken();
  if (!token) return { ok: false, error: NOT_CONNECTED_ERROR };
  const { getCommits } = require('./githubClient');
  try {
    const commits = await getCommits(token, owner, repo, branch, per_page);
    return { ok: true, commits };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// =======================================================================
// AI Improvement Framework: inventory, metrics, guardrail testing, guarded
// config upgrades, prompt A/B testing, dependency auditing, compliance
// tracking, an AI-focused changelog, a cross-project knowledge base, and
// side-by-side experiments - all operating on real files/processes for
// whichever project folder the renderer passes in. See each module's own
// header comment for what it actually does and doesn't do.
// =======================================================================

function wrapAsync(fn) {
  return async (_event, args) => {
    try {
      return await fn(args || {});
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };
}

// Inventory
ipcMain.handle('ai-fw-scan-inventory', wrapAsync(({ folder }) => aiInventory.scanProject(folder)));

// Metrics
ipcMain.handle('ai-fw-record-metric', wrapAsync(({ folder, event }) => aiMetrics.recordMetric(folder, event)));
ipcMain.handle('ai-fw-metrics-summary', wrapAsync(({ folder }) => aiMetrics.getMetricsSummary(folder)));
ipcMain.handle('ai-fw-metrics-history', wrapAsync(({ folder, limit }) => aiMetrics.getMetricsHistory(folder, limit)));

// Guardrail testing
ipcMain.handle('ai-fw-run-guardrails', wrapAsync(({ folder }) => aiGuardrailTester.runGuardrailTests(folder)));
ipcMain.handle('ai-fw-guardrail-history', wrapAsync(({ folder, limit }) => aiGuardrailTester.getGuardrailHistory(folder, limit)));

// Guarded config upgrades
ipcMain.handle('ai-fw-plan-upgrade', wrapAsync(({ folder, options }) => aiUpgradeOrchestrator.planUpgrade(folder, options || {})));
ipcMain.handle('ai-fw-apply-upgrade', wrapAsync(({ folder, options }) => aiUpgradeOrchestrator.applyUpgrade(folder, options || {})));
ipcMain.handle('ai-fw-upgrade-history', wrapAsync(({ folder, limit }) => aiUpgradeOrchestrator.getUpgradeHistory(folder, limit)));

// Prompt testing
ipcMain.handle('ai-fw-save-prompt-variant', wrapAsync(({ folder, variant }) => promptTesting.saveVariant(folder, variant || {})));
ipcMain.handle('ai-fw-record-prompt-result', wrapAsync(({ folder, variantName, result }) => promptTesting.recordResult(folder, variantName, result || {})));
ipcMain.handle('ai-fw-compare-prompts', wrapAsync(({ folder }) => promptTesting.compareVariants(folder)));

// Dependency auditing
ipcMain.handle('ai-fw-audit-dependencies', wrapAsync(({ folder }) => dependencyAuditor.auditAIDependencies(folder)));

// Compliance
ipcMain.handle('ai-fw-compliance-status', wrapAsync(({ folder }) => complianceMonitor.getComplianceStatus(folder)));
ipcMain.handle('ai-fw-log-violation', wrapAsync(({ folder, violation }) => complianceMonitor.logViolation(folder, violation || {})));

// Changelog
ipcMain.handle('ai-fw-generate-changelog', wrapAsync(({ folder, limit }) => changelogGenerator.generateAIChangelog(folder, { limit })));

// Knowledge base (cross-project, not tied to a folder)
ipcMain.handle('ai-fw-knowledge-add', wrapAsync(({ entry }) => knowledgeBase.addEntry(entry || {})));
ipcMain.handle('ai-fw-knowledge-search', wrapAsync(({ query }) => ({ ok: true, entries: knowledgeBase.search(query) })));
ipcMain.handle('ai-fw-knowledge-list', wrapAsync(() => ({ ok: true, entries: knowledgeBase.listAll() })));

// Experiments
ipcMain.handle('ai-fw-create-experiment', wrapAsync(({ folder, experiment }) => experimentationFramework.createExperiment(folder, experiment || {})));
ipcMain.handle('ai-fw-record-observation', wrapAsync(({ folder, observation }) => experimentationFramework.recordObservation(folder, observation || {})));
ipcMain.handle('ai-fw-analyze-experiment', wrapAsync(({ folder, name }) => experimentationFramework.analyzeExperiment(folder, name)));
ipcMain.handle('ai-fw-list-experiments', wrapAsync(({ folder }) => ({ ok: true, experiments: experimentationFramework.listExperiments(folder) })));
