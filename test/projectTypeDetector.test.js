const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { detectProjectType } = require('../projectTypeDetector');

function fixture(files = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-project-type-'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(folder, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return folder;
}

test('detects React projects as app projects', (t) => {
  const folder = fixture({ 'package.json': JSON.stringify({ dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' } }) });
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  assert.deepEqual(detectProjectType(folder), { templateId: 'app', source: 'interactive application dependencies' });
});

test('detects server-only Express projects as API projects', (t) => {
  const folder = fixture({ 'package.json': JSON.stringify({ dependencies: { express: '^5.0.0' } }) });
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  assert.deepEqual(detectProjectType(folder), { templateId: 'api', source: 'server framework dependencies' });
});

test('detects Next projects as websites when no interactive framework dependency is declared', (t) => {
  const folder = fixture({ 'package.json': JSON.stringify({ dependencies: { next: '^15.0.0' } }) });
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  assert.deepEqual(detectProjectType(folder), { templateId: 'website', source: 'website framework dependencies' });
});

test('detects plain index.html projects as websites', (t) => {
  const folder = fixture({ 'index.html': '<!doctype html><title>fixture</title>' });
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  assert.deepEqual(detectProjectType(folder), { templateId: 'website', source: 'web entry file' });
});

test('falls back to website for an otherwise unknown folder', (t) => {
  const folder = fixture();
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  assert.deepEqual(detectProjectType(folder), { templateId: 'website', source: 'default project type' });
});
