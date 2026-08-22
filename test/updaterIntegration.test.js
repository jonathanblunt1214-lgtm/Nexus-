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

test('installed Nexus checks for updates every time the application opens', () => {
  const main = read('main.js');
  assert.match(main, /webContents\.once\(['"]did-finish-load['"]/);
  assert.match(main, /if \(!app\.isPackaged\) return;\s*checkForUpdates\(\)/);
  assert.match(main, /Startup update check failed/);
});

test('available updates include safely rendered GitHub release notes', () => {
  const updater = read('updater.js');
  const html = read('index.html');
  const renderer = read('renderer.js');
  assert.match(updater, /fullChangelog\s*=\s*true/);
  assert.ok(html.includes('id="update-notes"'));
  assert.ok(html.includes('id="update-notes-content"'));
  assert.match(renderer, /notesContent\.textContent = releaseNotes/);
  assert.doesNotMatch(renderer, /notesContent\.innerHTML\s*=/);
});

test('release configuration publishes GitHub updater metadata', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.build.publish, {
    provider: 'github', owner: 'jonathanblunt1214-lgtm', repo: 'Nexus-',
  });
  assert.ok(pkg.dependencies['electron-updater']);
  assert.ok(pkg.scripts['dist:publish'].includes('--publish always'));

  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /tags:\s*\n\s*- ["']v\*["']/);
  assert.match(workflow, /npm run dist:publish/);
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(workflow, /contents:\s*write/);
});

test('local Windows builds use and verify the trusted Nexus certificate', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/buildLocalSigned.js');
  const signer = read('scripts/signLocalWindows.js');
  assert.equal(pkg.scripts['dist:local-signed'], 'node scripts/buildLocalSigned.js');
  assert.match(script, /sign:\s*path\.join\(__dirname, 'signLocalWindows\.js'\)/);
  assert.match(script, /Get-AuthenticodeSignature/);
  assert.match(script, /result\.Status !== 'Valid'/);
  assert.match(script, /publish:\s*'never'/);
  assert.match(signer, /'\/sha1', thumbprint, '\/s', 'My'/);
  assert.match(signer, /timestamp\.acs\.microsoft\.com/);
});

test('local signing certificate has a safe one-command renewal path', () => {
  const pkg = JSON.parse(read('package.json'));
  const renewal = read('scripts/renew-local-signing.ps1');
  assert.equal(pkg.scripts['signing:renew-local'], 'pwsh -NoProfile -File scripts/renew-local-signing.ps1');
  assert.match(renewal, /RenewWithinDays = 180/);
  assert.match(renewal, /KeyExportPolicy NonExportable/);
  assert.match(renewal, /Cert:\\CurrentUser\\Root/);
  assert.match(renewal, /Previous certificates were retained/);
});
