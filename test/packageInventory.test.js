const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expectedPackageFiles, verifySourcePackageList } = require('../scripts/verifyPackagedContents');
const { canonicalContent } = require('../scripts/inventoryContent');

test('repository inventory hashes text identically on Windows and GitHub while preserving binary bytes', () => {
  assert.deepEqual(canonicalContent(Buffer.from('one\r\ntwo\r\n')), Buffer.from('one\ntwo\n'));
  const binary = Buffer.from([0, 13, 10, 255]);
  assert.deepEqual(canonicalContent(binary), binary);
});

test('every file promised to an installed Nexus update exists before packaging', () => {
  const result = verifySourcePackageList();
  assert.equal(result.missing.length, 0);
  for (const required of ['main.js', 'projectLaunchPreflight.js', 'repository-file-manifest.json', 'release-notes.md']) assert.ok(expectedPackageFiles().includes(required));
});

test('signed and GitHub release builders verify packaged contents before acceptance or publication', () => {
  const signed = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'buildLocalSigned.js'), 'utf8');
  const publish = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'buildAndPublishVerified.js'), 'utf8');
  assert.ok(signed.lastIndexOf('verifyPackagedContents()') < signed.lastIndexOf('validateArtifacts(artifacts'));
  assert.ok(publish.indexOf('verifyPackagedContents()') < publish.indexOf("'--publish', 'always'"));
});

test('every release is blocked until the concurrent heavy-load stress gate passes', () => {
  const pkg = require('../package.json');
  const publish = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'buildAndPublishVerified.js'), 'utf8');
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  assert.equal(pkg.scripts['release:stress'], 'node scripts/releaseStressGate.js');
  const stress = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'releaseStressGate.js'), 'utf8');
  const workload = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'heavyWorkloadWorker.js'), 'utf8');
  for (const marker of ['NEXUS_HEAVY_FILES','NEXUS_HEAVY_SAVES','NEXUS_HEAVY_CHECKS','NEXUS_HEAVY_BUILDS']) assert.match(stress, new RegExp(marker));
  assert.match(workload, /writeJsonAtomic/);
  assert.match(workload, /indexWorkspace/);
  assert.match(workload, /checkCode/);
  assert.match(workload, /Parallel builds produced different artifacts/);
  assert.match(stress, /could not spawn/);
  assert.ok(publish.indexOf('releaseStressGate.js') < publish.indexOf("'--publish', 'always'"));
  assert.match(workflow, /Heavy-load release stress gate[\s\S]*npm run release:stress/);
});

test('verified release staging can redownload only missing hash-matched Nexus files and retry', () => {
  const repair = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'repairRepositoryInventory.js'), 'utf8');
  const publish = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'buildAndPublishVerified.js'), 'utf8');
  assert.match(repair, /raw\.githubusercontent\.com\/jonathanblunt1214-lgtm\/Nexus-/);
  assert.match(repair, /content\.length !== expected\.size \|\| sha256 !== expected\.sha256/);
  assert.match(repair, /Refusing automatic overwrite of changed Nexus files/);
  assert.match(repair, /attempts = 2/);
  assert.ok(publish.indexOf('repairRepositoryInventory.js') < publish.indexOf("'--publish', 'always'"));
});

test('Windows package smoke gate checks the actual app archive', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release-audit.yml'), 'utf8');
  assert.match(workflow, /electron-builder --win nsis --publish never[\s\S]*npm run inventory:package/);
});
