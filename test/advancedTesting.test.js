const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discover, snapshots, TestHistory, readCoverage } = require('../advancedTesting');

test('tests and snapshots are discovered without executing the suite', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-tests-'));
  try { fs.mkdirSync(path.join(folder, '__snapshots__')); fs.writeFileSync(path.join(folder, 'app.test.js'), ''); fs.writeFileSync(path.join(folder, '__snapshots__', 'app.test.js.snap'), 'snap'); assert.deepEqual(discover(folder).files, ['app.test.js']); assert.equal(snapshots(folder).files.length, 1); } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('test history computes duration and flakiness over repeated runs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-history-'));
  try { const history = new TestHistory(root); history.record(root, [{ name: 'works', status: 'pass', duration: 10 }]); const summary = history.record(root, [{ name: 'works', status: 'fail', duration: 30 }]); assert.equal(summary[0].flakiness, 0.5); assert.equal(summary[0].averageDuration, 20); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('coverage summary is mapped to file percentages', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-coverage-'));
  try { fs.mkdirSync(path.join(folder, 'coverage')); fs.writeFileSync(path.join(folder, 'coverage', 'coverage-summary.json'), JSON.stringify({ total: { lines: { pct: 90 }, statements: { pct: 91 }, functions: { pct: 92 }, branches: { pct: 93 } } })); const result = readCoverage(folder); assert.equal(result.ok, true); assert.equal(result.files[0].lines, 90); } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
