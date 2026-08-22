const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ToolRegistry, resolveInsideWorkspace, rejectShellMetacharacters } = require('../toolRegistry');

test('tool registry enforces capabilities', async () => {
  const registry = new ToolRegistry({ workspaceRoot: process.cwd() });
  registry.register({ name: 'read_meta', capability: 'workspace:read', handler: async () => 'ok' });
  await assert.rejects(() => registry.callTool('read_meta', {}, { allowedCapabilities: [] }), /Capability denied/);
  assert.equal(await registry.callTool('read_meta', {}, { allowedCapabilities: ['workspace:read'] }), 'ok');
});

test('path traversal is rejected', async () => {
  const root = path.join(process.cwd(), 'workspace');
  assert.equal(resolveInsideWorkspace(root, '../secret.txt'), null);
});

test('shell metacharacters are rejected', () => {
  assert.throws(() => rejectShellMetacharacters('npm test; rm -rf x'), /metacharacters/);
  assert.equal(rejectShellMetacharacters('npm-test'), 'npm-test');
});
