const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];
const warnings = [];
const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);
const exists = (file) => fs.existsSync(path.join(root, file));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const pkg = JSON.parse(read('package.json'));
if (!pkg.version || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(pkg.version)) fail('package.json must contain a valid semantic version.');
if (!pkg.main || !exists(pkg.main)) fail(`package main entry does not exist: ${pkg.main || '(missing)'}`);

for (const file of pkg.build?.files || []) {
  if (!exists(file)) fail(`electron-builder file entry does not exist: ${file}`);
}

const accidentalRootArtifacts = [
  'COMMIT_EDITMSG', 'FETCH_HEAD', 'ORIG_HEAD', 'HEAD', 'packed-refs',
  'config', 'description', 'index', 'main', 'gitignore',
  '.gitignore[1].gitignore', 'AI_IMPROVEMENT_FRAMEWORK[1].md', 'aiAlerts[1].js',
];
for (const file of accidentalRootArtifacts) if (exists(file)) fail(`release tree contains accidental repository artifact: ${file}`);

const rootEntries = fs.readdirSync(root);
for (const name of rootEntries) {
  if (/\[\d+\]/.test(name)) fail(`release tree contains duplicate-export style filename: ${name}`);
}

const bootstrap = read('bootstrap.js');
if (!/require\(['"]\.\/main\.js['"]\)/.test(bootstrap)) fail('bootstrap must load main.js explicitly to prevent extensionless-file shadowing.');
if (!/registerSection7Ipc/.test(bootstrap) || !/registerSection8Ipc/.test(bootstrap)) fail('bootstrap must register Sections 7 and 8 IPC before main.js.');

const preload = read('preload.js');
for (const api of ['visionCapturePreview', 'debuggerLaunchIsolated']) {
  if (!preload.includes(api)) fail(`preload bridge is missing Section 7 API: ${api}`);
}
for (const api of ['pluginsScan', 'pluginsList', 'pluginsEnable', 'pluginsDisable', 'pluginsHealth']) {
  if (!preload.includes(api)) fail(`preload bridge is missing Section 8 API: ${api}`);
}

if (exists('package-lock.json')) {
  try {
    const lock = JSON.parse(read('package-lock.json'));
    const rootPkg = lock.packages?.[''] || {};
    if (rootPkg.version !== pkg.version) fail(`package-lock root version ${rootPkg.version || '(missing)'} does not match package.json ${pkg.version}.`);
    for (const group of ['dependencies', 'devDependencies']) {
      const wanted = pkg[group] || {};
      const locked = rootPkg[group] || {};
      for (const [name, range] of Object.entries(wanted)) {
        if (locked[name] !== range) fail(`package-lock ${group}.${name} is stale or missing.`);
      }
    }
  } catch (error) {
    fail(`package-lock.json is invalid JSON: ${error.message}`);
  }
} else {
  warn('package-lock.json is missing; release installs are not reproducible.');
}

const mainSource = read('main.js');
if (/webPreferences:\s*\{[\s\S]*?nodeIntegration:\s*true/.test(mainSource)) fail('Electron renderer must not enable nodeIntegration.');
if (!/contextIsolation:\s*true/.test(mainSource)) fail('Electron renderer must keep contextIsolation enabled.');
if (/function saveConfig\([\s\S]{0,300}writeFileSync/.test(mainSource)) warn('main.js saveConfig still uses synchronous non-atomic persistence; hardening recommended before release.');

const pluginRuntime = read('pluginRuntime.js');
if (/vm\.createContext/.test(pluginRuntime)) warn('Plugin VM runs in the Electron main process; handler infinite loops are not preempted by the initial vm.Script timeout. Treat this as a release-blocking isolation review item for untrusted third-party plugins.');

const section8 = read('section8Ipc.js');
if (/path\.resolve\(value\)/.test(section8) && !/getProjectsRoot|resolveProjectPath/.test(section8)) warn('Section 8 accepts any existing directory as projectRoot; bind plugin IPC to registered/active Nexus workspaces before exposing it to untrusted renderer content.');

for (const message of warnings) console.warn(`[WARN] ${message}`);
for (const message of failures) console.error(`[FAIL] ${message}`);

console.log(`Release audit: ${failures.length} failure(s), ${warnings.length} warning(s).`);
if (failures.length) process.exit(1);
console.log('[PASS] Static release audit passed.');
