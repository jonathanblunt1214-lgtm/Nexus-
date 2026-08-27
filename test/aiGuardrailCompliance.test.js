const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runGuardrailTests, getGuardrailHistory, findGuardrailScripts } = require('../aiGuardrailTester');
const { getComplianceStatus, logViolation } = require('../complianceMonitor');

function makeProject(scripts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-guardrail-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', scripts }, null, 2));
  return root;
}

test('findGuardrailScripts only matches guardrail/contract/safety/compliance/constitution script names', () => {
  const root = makeProject({
    'test:safety-contract': 'node -e "process.exit(0)"',
    build: 'node -e "process.exit(0)"',
    'compliance:check': 'node -e "process.exit(0)"',
  });
  const found = findGuardrailScripts(root);
  assert.deepEqual(found.sort(), ['compliance:check', 'test:safety-contract']);
});

test('findGuardrailScripts returns empty for a missing or unparsable package.json', () => {
  const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-guardrail-'));
  assert.deepEqual(findGuardrailScripts(missing), []);

  const broken = makeProject({});
  fs.writeFileSync(path.join(broken, 'package.json'), '{ not valid json');
  assert.deepEqual(findGuardrailScripts(broken), []);
});

test('runGuardrailTests reports no guardrails without inventing a score', async () => {
  const root = makeProject({ build: 'node -e "process.exit(0)"' });
  const result = await runGuardrailTests(root);
  assert.equal(result.ok, true);
  assert.equal(result.hasGuardrails, false);
  assert.equal(result.score, null);
  assert.deepEqual(result.results, []);
});

test('runGuardrailTests runs real scripts and computes an honest pass/fail score', async () => {
  const root = makeProject({
    'test:safety-contract': process.platform === 'win32' ? 'node -e "process.exit(0)"' : 'node -e "process.exit(0)"',
    'test:guardrail-block': 'node -e "process.exit(1)"',
  });
  const result = await runGuardrailTests(root);
  assert.equal(result.ok, true);
  assert.equal(result.hasGuardrails, true);
  assert.equal(result.total, 2);
  assert.equal(result.passed, 1);
  assert.equal(result.score, 50);

  const passing = result.results.find((r) => r.script === 'test:safety-contract');
  const failing = result.results.find((r) => r.script === 'test:guardrail-block');
  assert.equal(passing.passed, true);
  assert.equal(passing.error, null);
  assert.equal(failing.passed, false);
  assert.ok(failing.error);
});

test('runGuardrailTests persists runs so getGuardrailHistory returns them newest-first', async () => {
  const root = makeProject({ 'test:safety-contract': 'node -e "process.exit(0)"' });
  await runGuardrailTests(root);
  await new Promise((r) => setTimeout(r, 5));
  await runGuardrailTests(root);

  const history = getGuardrailHistory(root, 10);
  assert.equal(history.length, 2);
  // newest-first: the second run's timestamp must not be earlier than the first's
  assert.ok(new Date(history[0].runAt).getTime() >= new Date(history[1].runAt).getTime());
});

test('runGuardrailTests rejects a missing project folder instead of crashing', async () => {
  const result = await runGuardrailTests(path.join(os.tmpdir(), 'nexus-guardrail-does-not-exist'));
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/i);
});

test('getComplianceStatus reports no data before any guardrail run has happened', () => {
  const root = makeProject({ 'test:safety-contract': 'node -e "process.exit(0)"' });
  const status = getComplianceStatus(root);
  assert.equal(status.ok, true);
  assert.equal(status.hasGuardrailData, false);
  assert.equal(status.latestScore, null);
  assert.equal(status.trend, 'unknown');
  assert.deepEqual(status.recentViolations, []);
});

test('getComplianceStatus computes trend correctly across improving, regressing, and stable runs', async () => {
  const root = makeProject({});

  async function runAt(passCount, failCount) {
    const scripts = {};
    for (let i = 0; i < passCount; i++) scripts[`test:safety-pass-${i}`] = 'node -e "process.exit(0)"';
    for (let i = 0; i < failCount; i++) scripts[`test:safety-fail-${i}`] = 'node -e "process.exit(1)"';
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', scripts }, null, 2));
    return runGuardrailTests(root);
  }

  await runAt(1, 1); // score 50
  let status = getComplianceStatus(root);
  assert.equal(status.trend, 'first-run');
  assert.equal(status.latestScore, 50);

  await new Promise((r) => setTimeout(r, 5));
  await runAt(2, 0); // score 100 - improving
  status = getComplianceStatus(root);
  assert.equal(status.trend, 'improving');
  assert.equal(status.latestScore, 100);
  assert.equal(status.previousScore, 50);

  await new Promise((r) => setTimeout(r, 5));
  await runAt(0, 1); // score 0 - regressing
  status = getComplianceStatus(root);
  assert.equal(status.trend, 'regressing');

  await new Promise((r) => setTimeout(r, 5));
  await runAt(0, 1); // score 0 again - stable
  status = getComplianceStatus(root);
  assert.equal(status.trend, 'stable');
});

test('logViolation requires a rule and getComplianceStatus surfaces logged violations newest-first', () => {
  const root = makeProject({});
  const rejected = logViolation(root, { detail: 'missing rule name' });
  assert.equal(rejected.ok, false);

  const first = logViolation(root, { rule: 'no-secrets-in-code', detail: 'first', severity: 'high' });
  assert.equal(first.ok, true);
  const second = logViolation(root, { rule: 'no-secrets-in-code', detail: 'second' });
  assert.equal(second.ok, true);

  const status = getComplianceStatus(root);
  assert.equal(status.openViolationCount, 2);
  assert.equal(status.recentViolations[0].detail, 'second');
  assert.equal(status.recentViolations[1].detail, 'first');
  assert.equal(status.recentViolations[1].severity, 'high');
  assert.equal(status.recentViolations[0].severity, 'medium');
});

test('logViolation and getComplianceStatus tolerate a corrupt violations file instead of crashing', () => {
  const root = makeProject({});
  fs.writeFileSync(path.join(root, '.nexus-ai-compliance-violations.json'), 'not valid json');
  const status = getComplianceStatus(root);
  assert.deepEqual(status.recentViolations, []);
  const result = logViolation(root, { rule: 'x' });
  assert.equal(result.ok, true);
});
