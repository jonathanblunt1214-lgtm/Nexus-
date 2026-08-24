const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createExportPreflight, exportVerifiedProject, verifyExportFolder } = require('../projectExportProtection');

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-export-source-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.writeFileSync(target, content);
  }
  return root;
}

const passingChecker = async () => ({ ok:true, recognized:true, available:true, checker:'test', diagnostics:[] });

test('protected export links every text file to the checker and hashes every file', async t => {
  const root = project({ 'src/index.js':"import './helper.js';\n", 'src/helper.js':'export const value = 1;\n', 'asset.bin':Buffer.from([0, 1, 2]) });
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  let calls = 0;
  const result = await createExportPreflight({ folder:root, runCodeCheck:async (...args) => { calls += 1; return passingChecker(...args); } });
  assert.equal(result.ok, true);
  assert.equal(result.manifest.fileCount, 3);
  assert.equal(calls, 2);
  assert.equal(result.manifest.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)), true);
});

test('checker errors or missing relative references block export before copying', async t => {
  const root = project({ 'index.js':"import './missing.js';\n" });
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-export-destination-'));
  t.after(() => { fs.rmSync(root, { recursive:true, force:true }); fs.rmSync(destination, { recursive:true, force:true }); });
  const result = await exportVerifiedProject({ folder:root, destinationParent:destination, runCodeCheck:async () => ({ recognized:true, available:true, checker:'test', diagnostics:[{ severity:'error', message:'bad code' }] }) });
  assert.equal(result.ok, false);
  assert.equal(fs.readdirSync(destination).length, 0);
  assert.equal(result.checker.errors.length, 1);
  assert.equal(result.missingReferences.length, 1);
});

test('successful export carries a manifest and matches it after leaving staging', async t => {
  const root = project({ 'index.js':'console.log("ok");\n', 'public/index.html':'<!doctype html><title>ok</title>' });
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-export-destination-'));
  t.after(() => { fs.rmSync(root, { recursive:true, force:true }); fs.rmSync(destination, { recursive:true, force:true }); });
  const result = await exportVerifiedProject({ folder:root, destinationParent:destination, runCodeCheck:passingChecker });
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(result.path, 'nexus-export-integrity.json')), true);
  assert.equal(verifyExportFolder(result.path, result.manifest).ok, true);
});

test('narrow IPC exposes protected export without raw filesystem access', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(preload, /projectExportPreflight.*project-export:preflight/);
  assert.match(preload, /exportProtectedProject.*project-export:run/);
  assert.match(main, /project-export:run[\s\S]*requireWorkspacePermission\(folder, 'checker'\)/);
});
