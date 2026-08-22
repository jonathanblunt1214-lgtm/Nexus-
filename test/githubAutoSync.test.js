const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('project GitHub auto-sync is opt-in and constrained to 30 through 600 seconds', () => {
  const html = read('index.html');
  const renderer = read('renderer.js');
  assert.match(html, /id="github-auto-sync-enabled"/);
  assert.match(html, /min="30" max="600"/);
  assert.match(html, /id="github-login-btn"[^>]*>Log in</);
  assert.match(html, /id="github-logout-btn"[^>]*>Log out</);
  assert.match(html, /for="github-auto-sync-seconds">Save\/push interval</);
  assert.equal((html.match(/id="github-token"/g) || []).length, 1);
  assert.match(renderer, /GITHUB_AUTO_SYNC_MIN_SECONDS = 30/);
  assert.match(renderer, /GITHUB_AUTO_SYNC_MAX_SECONDS = 600/);
  assert.match(renderer, /nexus_github_auto_sync_enabled/);
  assert.match(renderer, /intervalInput\.min = String\(GITHUB_AUTO_SYNC_MIN_SECONDS\)/);
  assert.match(renderer, /intervalInput\.max = String\(GITHUB_AUTO_SYNC_MAX_SECONDS\)/);
  assert.match(renderer, /const saveResult = await saveAllDirtyEditorFiles\('Timed Auto Save before GitHub push'\)/);
  assert.match(renderer, /const validation = await window\.nexus\.githubListRepos\(\)/);
  assert.match(renderer, /await window\.nexus\.clearGitHubToken\(\)/);
});

test('auto-sync uses a narrow bridge and only accepts GitHub origins', () => {
  const preload = read('preload.js');
  const main = read('main.js');
  assert.match(preload, /gitAutoSync:.*ipcRenderer\.invoke\('git-auto-sync'/);
  assert.match(main, /ipcMain\.handle\('git-auto-sync'/);
  assert.match(main, /github\\\.com\[\/:\]/i);
  assert.match(main, /project is named exactly Nexus/);
});

test('closing Nexus is blocked until configured projects finish syncing', () => {
  const preload = read('preload.js');
  const renderer = read('renderer.js');
  const main = read('main.js');
  assert.match(preload, /setProjectsForExitSync:.*ipcRenderer\.send\('set-projects-for-exit-sync'/);
  assert.match(renderer, /window\.nexus\.setProjectsForExitSync\(projects\)/);
  assert.match(main, /mainWindow\.on\('close', \(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?syncProjectsBeforeExit\(\)/);
  assert.match(main, /if \(failures\.length\)[\s\S]*?Nexus stayed open/);
  assert.match(main, /exitSyncComplete = true;[\s\S]*?mainWindow\?\.close\(\)/);
  assert.match(main, /const hadChanges = Boolean\(status\.output\.trim\(\)\);[\s\S]*?runGitArgs\(folder, \['push', '-u', 'origin', 'HEAD'\]\)/);
});

test('unsaved local editor files are forced to disk before exit sync', () => {
  const preload = read('preload.js');
  const renderer = read('renderer.js');
  const main = read('main.js');
  assert.match(preload, /onExitSaveRequest:.*exit-save-request/);
  assert.match(preload, /completeExitSave:.*exit-save-complete/);
  assert.match(renderer, /async function saveAllDirtyEditorFiles\(/);
  assert.match(renderer, /Automatic save before Nexus closes/);
  assert.match(main, /const saveResult = await requestRendererSaveBeforeExit\(\)/);
  assert.match(main, /local project files could not be saved/);
});

test('shutdown retries, repairs Git, and caches offline pushes in a background helper', () => {
  const main = read('main.js');
  const helper = read('backgroundGitSync.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(main, /setTimeout\(resolve, 20_000\)/);
  assert.match(main, /async function repairAndPushProject/);
  assert.match(main, /\['pull', '--rebase', 'origin'/);
  assert.match(main, /function isNetworkGitError/);
  assert.match(main, /ELECTRON_RUN_AS_NODE: '1'/);
  assert.match(helper, /setTimeout\(attempt, 30_000\)/);
  assert.match(helper, /\['push', '-u', 'origin', 'HEAD'\]/);
  assert.ok(pkg.build.files.includes('backgroundGitSync.js'));
});
