const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PersistentMemoryEngine } = require('../memoryEngine');

const embedder = { embed: async (text) => {
  const s = String(text).toLowerCase();
  return [s.includes('hook') ? 1 : 0, s.includes('zod') ? 1 : 0, s.length / 100];
} };

test('indexes only with accepted commit provenance and recalls relevant memory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-memory-'));
  const memory = new PersistentMemoryEngine({ projectRoot: root, embedder });
  await assert.rejects(() => memory.indexAcceptedPreferences([{ preferenceSummary: 'prefer hooks' }], ''), /sourceCommitHash/);
  await memory.indexAcceptedPreferences([{ category:'architectural_pattern', preferenceSummary:'prefer hooks over classes' }], 'abc123');
  const recalled = await memory.recallRelevantPreferences('build a hook', 1);
  assert.equal(recalled[0].sourceCommitHash, 'abc123');
  assert.match(recalled[0].preferenceSummary, /hooks/);
});

test('memory can be inspected, pinned, and deleted', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-memory-'));
  const memory = new PersistentMemoryEngine({ projectRoot: root, embedder });
  await memory.indexAcceptedPreferences([{ preferenceSummary:'use zod schemas' }], 'def456');
  const id = memory.list()[0].id;
  assert.equal(memory.pin(id), true);
  assert.equal(memory.list()[0].pinned, true);
  assert.equal(memory.delete(id), true);
  assert.equal(memory.list().length, 0);
});

test('planning context states security precedence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-memory-'));
  const memory = new PersistentMemoryEngine({ projectRoot: root, embedder });
  const context = memory.buildPlanningContext('task', [{ preferenceSummary:'style preference' }]);
  assert.match(context.precedence, /security\/constitution constraints override/);
});
