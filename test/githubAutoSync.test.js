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
  assert.match(renderer, /GITHUB_AUTO_SYNC_MIN_SECONDS = 30/);
  assert.match(renderer, /GITHUB_AUTO_SYNC_MAX_SECONDS = 600/);
  assert.match(renderer, /nexus_github_auto_sync_enabled/);
});

test('auto-sync uses a narrow bridge and only accepts GitHub origins', () => {
  const preload = read('preload.js');
  const main = read('main.js');
  assert.match(preload, /gitAutoSync:.*ipcRenderer\.invoke\('git-auto-sync'/);
  assert.match(main, /ipcMain\.handle\('git-auto-sync'/);
  assert.match(main, /github\\\.com\[\/:\]/i);
  assert.match(main, /project is named exactly Nexus/);
});
