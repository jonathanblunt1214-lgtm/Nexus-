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
if (!/isAuthorizedProjectRoot/.test(bootstrap) || !/listProjects/.test(bootstrap)) fail('bootstrap must authorize Section 8 project roots against the Nexus project registry.');

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
  fail('package-lock.json is missing; release installs must be reproducible.');
}

const mainSource = read('main.js');
if (/webPreferences:\s*\{[\s\S]*?nodeIntegration:\s*true/.test(mainSource)) fail('Electron renderer must not enable nodeIntegration.');
if (!/contextIsolation:\s*true/.test(mainSource)) fail('Electron renderer must keep contextIsolation enabled.');
const configStart = mainSource.indexOf('// Where we persist small bits of config');
const configEnd = mainSource.indexOf('// ---- Terminal state', configStart);
const configSource = configStart >= 0 && configEnd > configStart ? mainSource.slice(configStart, configEnd) : '';
if (!configSource) fail('main.js config persistence section could not be located.');
if (!/await fs\.promises\.readFile\(CONFIG_PATH/.test(configSource)) fail('main.js must initialize nexus-config.json asynchronously.');
if (!/writeJsonAtomic\(CONFIG_PATH/.test(configSource)) fail('main.js saveConfig must use asynchronous atomic persistence.');
if (/readFileSync\(CONFIG_PATH|writeFileSync\(CONFIG_PATH|writeJsonAtomicSync\(CONFIG_PATH/.test(configSource)) fail('main.js must not use synchronous nexus-config.json persistence.');
if (!/await initializeConfig\(\)/.test(mainSource)) fail('main.js must initialize config before creating the renderer window.');

const pluginRuntime = read('pluginRuntime.js');
const pluginWorker = exists('pluginWorker.js') ? read('pluginWorker.js') : '';
if (!/new Worker\(/.test(pluginRuntime) || !/worker_threads/.test(pluginRuntime)) fail('Plugin runtime must execute third-party plugins in a killable worker boundary.');
if (!/terminate\(\)/.test(pluginRuntime) || !/timed out/.test(pluginRuntime)) fail('Plugin runtime must terminate workers on execution timeout.');
if (!/vm\.createContext/.test(pluginWorker)) fail('Plugin worker must retain the constrained VM sandbox inside the worker boundary.');
if (/vm\.createContext/.test(pluginRuntime)) fail('Plugin VM must not execute in the Electron main-process runtime module.');

const section8 = read('section8Ipc.js');
if (!/isAuthorizedProjectRoot/.test(section8) || !/Plugin access denied/.test(section8)) fail('Section 8 IPC must reject unregistered project roots.');

for (const message of warnings) console.warn(`[WARN] ${message}`);
for (const message of failures) console.error(`[FAIL] ${message}`);

console.log(`Release audit: ${failures.length} failure(s), ${warnings.length} warning(s).`);
if (failures.length) process.exit(1);
console.log('[PASS] Static release audit passed.');
