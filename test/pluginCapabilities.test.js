const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWorkspaceWriteHandler, safeWorkspacePath } = require('../pluginCapabilities');

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

test('workspace write rejects traversal and does not overwrite by default', async () => {
  const root = tempProject();
  assert.throws(() => safeWorkspacePath(root, '../outside.txt'), /escapes the project/);
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
