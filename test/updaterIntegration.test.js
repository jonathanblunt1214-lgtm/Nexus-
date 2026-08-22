const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('GitHub Releases updater is wired through a narrow renderer bridge', () => {
  const main = read('main.js');
  const preload = read('preload.js');
  for (const channel of ['updater:check', 'updater:download', 'updater:install', 'updater:status']) {
    assert.ok(main.includes(channel), `missing main-process updater channel ${channel}`);
    assert.ok(preload.includes(channel), `missing preload updater channel ${channel}`);
  }
  assert.doesNotMatch(preload, /require\(['"]electron-updater['"]\)/);
});

test('Settings exposes installed version, progress, and explicit restart action', () => {
  const html = read('index.html');
  const renderer = read('renderer.js');
  for (const id of ['update-current-version', 'update-progress', 'update-check-btn', 'update-download-btn', 'update-install-btn']) {
    assert.ok(html.includes(`id="${id}"`), `missing updater UI element ${id}`);
  }
  assert.match(html, /Restart &amp; Update/);
  assert.match(renderer, /onUpdaterStatus\(renderReleaseUpdateStatus\)/);
});

test('release configuration publishes GitHub updater metadata', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.build.publish, {
    provider: 'github', owner: 'jonathanblunt1214-lgtm', repo: 'Nexus-',
  });
  assert.ok(pkg.dependencies['electron-updater']);
  assert.ok(pkg.scripts['dist:publish'].includes('--publish always'));
});
