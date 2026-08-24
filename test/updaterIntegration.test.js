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
  const createWindow = main.slice(main.indexOf('function createWindow()'), main.indexOf('function setupPreviewSession()'));
  assert.ok(createWindow.indexOf('initUpdater(mainWindow)') < createWindow.indexOf("mainWindow.loadFile('index.html')"), 'updater must initialize before navigation');
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
  assert.equal(pkg.scripts['dist:publish'], 'node scripts/buildAndPublishVerified.js');
  assert.match(read('scripts/buildAndPublishVerified.js'), /verifyPackagedContents\(\)[\s\S]*'--publish', 'always'/);

  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /tags:\s*\n\s*- ["']v\*["']/);
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /npm run dist:publish/);
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(workflow, /contents:\s*write/);
  assert.equal(pkg.build.releaseInfo.releaseNotesFile, 'release-notes.md');
});
test('local Windows builds use and verify the trusted Nexus certificate', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/buildLocalSigned.js');
  const signer = read('scripts/signLocalWindows.js');
  assert.equal(pkg.scripts['dist:local-signed'], 'node scripts/buildLocalSigned.js');
  assert.match(script, /signtoolOptions:\s*\{/);
  assert.match(script, /sign:\s*path\.join\(__dirname, 'signLocalWindows\.js'\)/);
  assert.match(script, /X509Store\]\:\:new\('Root', 'CurrentUser'\)/);
  assert.match(script, /\$root\.Add\(\$cert\)/);
  assert.match(script, /Get-AuthenticodeSignature/);
  assert.match(script, /result\.Status !== 'Valid'/);
  assert.match(script, /MIN_INSTALLER_BYTES/);
  assert.match(script, /removeStaleArtifacts/);
  assert.match(script, /validateArtifacts/);
  assert.match(script, /process\.exit\(1\)/);
  assert.match(script, /publish:\s*'never'/);
  assert.match(signer, /getSignToolPath/);
  assert.doesNotMatch(signer, /getSignVendorPath/);
  assert.match(signer, /'\/sha1', thumbprint, '\/s', 'My'/);
  assert.match(signer, /timestamp\.acs\.microsoft\.com/);
});

test('local signing certificate has a safe one-command renewal path', () => {
  const pkg = JSON.parse(read('package.json'));
  const renewal = read('scripts/renew-local-signing.ps1');
  assert.equal(pkg.scripts['signing:renew-local'], 'pwsh -NoProfile -File scripts/renew-local-signing.ps1');
  assert.match(renewal, /RenewWithinDays = 180/);
  assert.match(renewal, /KeyExportPolicy Exportable/);
  assert.match(renewal, /Export-PfxCertificate/);
  assert.match(renewal, /AES256_SHA256/);
  assert.match(renewal, /Cert:\\CurrentUser\\Root/);
  assert.match(renewal, /Previous certificates were retained/);
});

test('portable signing identity can be restored without putting its password on the command line', () => {
  const pkg = JSON.parse(read('package.json'));
  const restore = read('scripts/restore-local-signing.ps1');
  assert.equal(pkg.scripts['signing:restore-local'], 'pwsh -NoProfile -File scripts/restore-local-signing.ps1');
  assert.match(restore, /Read-Host 'Enter the PFX recovery password' -AsSecureString/);
  assert.match(restore, /Import-PfxCertificate/);
  assert.match(restore, /Cert:\\CurrentUser\\Root/);
});

test('signed build validation rejects a truncated installer even if a stale file exists', () => {
  const os = require('node:os');
  const { validateArtifacts, MIN_INSTALLER_BYTES } = require('../scripts/buildLocalSigned');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-signed-artifact-'));
  const artifacts = { installer:path.join(dir, 'setup.exe'), blockMap:path.join(dir, 'setup.exe.blockmap'), executable:path.join(dir, 'Nexus.exe') };
  fs.writeFileSync(artifacts.installer, Buffer.alloc(189828));
  fs.writeFileSync(artifacts.blockMap, Buffer.alloc(200));
  fs.writeFileSync(artifacts.executable, Buffer.alloc(200));
  assert.ok(fs.statSync(artifacts.installer).size < MIN_INSTALLER_BYTES);
  assert.throws(() => validateArtifacts(artifacts, 'thumbprint', () => {}), /installer is only 189828 bytes/);
  fs.rmSync(dir, { recursive:true, force:true });
});
