const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { computeFileHash, computeMerkleRoot, indexWorkspace } = require('../workspaceIndexer');
const { getSemanticContext, clearSemanticContextCache } = require('../semanticContext');

test('workspace indexer detects changed, unchanged, and removed files deterministically', () => {
  const initial = indexWorkspace([
    { path: 'a.js', content: 'export const a = 1;' },
    { path: 'b.js', content: 'export const b = 2;' },
  ]);

  assert.equal(initial.hashes['a.js'], computeFileHash('export const a = 1;'));
  assert.equal(initial.rootHash, computeMerkleRoot(initial.hashes));
  assert.deepEqual(initial.changed.sort(), ['a.js', 'b.js']);

  const next = indexWorkspace([
    { path: 'a.js', content: 'export const a = 1;' },
    { path: 'c.js', content: 'export const c = 3;' },
  ], initial.hashes);

  assert.deepEqual(next.unchanged, ['a.js']);
  assert.deepEqual(next.changed, ['c.js']);
  assert.deepEqual(next.removed, ['b.js']);
});

test('semantic worker extracts symbols and produces a bounded repository map', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-semantic-'));
  t.after(async () => {
    clearSemanticContextCache(root);
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(root, 'math.ts'), [
    'export function add(a: number, b: number) {',
    '  return a + b;',
    '}',
    'export const multiply = (a: number, b: number) => a * b;',
  ].join('\n'));

  await fs.writeFile(path.join(root, 'panel.tsx'), [
    "import { add } from './math';",
    'export function Panel() {',
    '  return <div>{add(1, 2)}</div>;',
    '}',
  ].join('\n'));

  const first = await getSemanticContext(root, { mapCharBudget: 1024 });
  assert.equal(first.filesParsed, 2);
  assert.ok(first.repositoryMap.length <= 1024);
  assert.ok(first.repositoryMap.includes('math.ts'));
  assert.ok(first.files.some((file) => file.symbols.some((symbol) => symbol.name === 'add')));
  assert.ok(first.files.some((file) => file.symbols.some((symbol) => symbol.name === 'Panel')));
  assert.equal(first.changedFiles.length, 2);

  const second = await getSemanticContext(root, { mapCharBudget: 1024 });
  assert.equal(second.changedFiles.length, 0);
  assert.equal(second.unchangedFiles.length, 2);
  assert.equal(second.rootHash, first.rootHash);

  await fs.writeFile(path.join(root, 'math.ts'), 'export function add(a: number, b: number) { return a - b; }\n');
  const third = await getSemanticContext(root, { mapCharBudget: 1024 });
  assert.deepEqual(third.changedFiles, ['math.ts']);
  assert.notEqual(third.rootHash, first.rootHash);
});
