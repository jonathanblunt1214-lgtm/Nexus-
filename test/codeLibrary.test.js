const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { searchCodeLibrary, libraryFacets } = require('../codeLibrary');

function project(t, files = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-library-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), content);
  return folder;
}

test('ranks patterns for the current project and file', (t) => {
  const folder = project(t, { 'package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }) });
  const results = searchCodeLibrary(folder, { query: 'react async', currentFile: 'src/view.tsx' });
  assert.equal(results[0].id, 'react-async-hook');
  assert.equal(results[0].compatible, true);
});

test('reports dependencies without installing or executing them', (t) => {
  const folder = project(t, { 'package.json': '{}' });
  const [result] = searchCodeLibrary(folder, { query: 'phaser scene' });
  assert.equal(result.id, 'phaser-scene');
  assert.equal(result.compatible, false);
  assert.deepEqual(result.missingDependencies, ['phaser']);
});

test('recognizes Python requirements and exposes useful filters', (t) => {
  const folder = project(t, { 'requirements.txt': 'fastapi==0.116.0\n' });
  const results = searchCodeLibrary(folder, { language: 'python', category: 'Backend API', currentFile: 'api.py' });
  assert.equal(results[0].id, 'python-fastapi-route');
  assert.equal(results[0].compatible, true);
  assert.ok(libraryFacets().languages.includes('python'));
});

test('editor library requires an explicit preview and insertion action', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer.js'), 'utf8');
  assert.match(html, /Curated project patterns/);
  assert.match(html, /Insert at cursor/);
  assert.match(html, /nothing runs automatically/);
  assert.match(renderer, /previewCodeLibraryEntry/);
  assert.match(renderer, /replaceRange\(selectedCodeLibraryEntry\.code/);
});
