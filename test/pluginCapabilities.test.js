const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWorkspaceReadHandler, createWorkspaceWriteHandler, safeWorkspacePath } = require('../pluginCapabilities');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-plugin-capability-'));
}

test('workspace write stays inside the authorized project and creates files atomically', async () => {
  const root = tempProject();
  const write = createWorkspaceWriteHandler(root);
  const result = await write({ files: [{ path: 'governingDocuments/test.md', content: '# ok\n' }] }, { pluginId: 'demo' });
  assert.equal(result.ok, true);
  assert.equal(result.pluginId, 'demo');
  assert.equal(fs.readFileSync(path.join(root, 'governingDocuments', 'test.md'), 'utf8'), '# ok\n');
});

test('workspace read lists and reads governance files without following symlinks', async () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, 'governingDocuments', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'governingDocuments', 'a.md'), 'a', 'utf8');
  fs.writeFileSync(path.join(root, 'governingDocuments', 'nested', 'b.md'), 'b', 'utf8');
  const read = createWorkspaceReadHandler(root);
  const listed = await read({ operation: 'list', path: 'governingDocuments' });
  assert.deepEqual(listed.files, ['governingDocuments/a.md', path.join('governingDocuments', 'nested', 'b.md')].sort());
  const file = await read({ operation: 'read', path: 'governingDocuments/a.md' });
  assert.equal(file.content, 'a');
});

test('workspace read and write reject traversal and write does not overwrite by default', async () => {
  const root = tempProject();
  assert.throws(() => safeWorkspacePath(root, '../outside.txt'), /escapes the project/);
  const read = createWorkspaceReadHandler(root);
  await assert.rejects(() => read({ operation: 'read', path: '../outside.txt' }), /escapes the project/);
  const existing = path.join(root, 'existing.txt');
  fs.writeFileSync(existing, 'original', 'utf8');
  const write = createWorkspaceWriteHandler(root);
  await assert.rejects(() => write({ files: [{ path: 'existing.txt', content: 'replacement' }] }), /will not overwrite/);
  assert.equal(fs.readFileSync(existing, 'utf8'), 'original');
});

test('workspace write overwrites only when explicitly requested', async () => {
  const root = tempProject();
  const existing = path.join(root, 'existing.txt');
  fs.writeFileSync(existing, 'original', 'utf8');
  const write = createWorkspaceWriteHandler(root);
  const result = await write({ overwrite: true, files: [{ path: 'existing.txt', content: 'replacement' }] }, { pluginId: 'the-crucible' });
  assert.equal(result.overwrite, true);
  assert.equal(fs.readFileSync(existing, 'utf8'), 'replacement');
});
