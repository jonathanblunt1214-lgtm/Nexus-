const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PUBLIC_LAUNCH_VERSION, nextBuildNumber, approveNextBuild, advanceBuildForCommit, normalizeBuildState } = require('../buildNumber');

test('the first automatic build is 0.0.03 and 1.0.0 remains reserved for public launch', () => {
  assert.equal(nextBuildNumber(null), '0.0.03');
  assert.equal(nextBuildNumber('0.0.03'), '0.0.04');
  assert.equal(nextBuildNumber('0.0.9'), '0.0.10');
  assert.equal(nextBuildNumber('4.12.99'), '4.12.100');
  assert.equal(PUBLIC_LAUNCH_VERSION, '1.0.0');
  assert.equal(nextBuildNumber('0.0.999'), '0.0.1000');
  assert.notEqual(nextBuildNumber('0.0.999'), PUBLIC_LAUNCH_VERSION);
});

test('a new source commit receives a build automatically', () => {
  const state = advanceBuildForCommit(null, { commitHash:'abc1234', assignedAt:'2026-08-22T12:00:00.000Z' });
  assert.equal(state.current, '0.0.03');
  assert.deepEqual(state.history[0], {
    number:'0.0.03',
    approvedAt:'2026-08-22T12:00:00.000Z',
    assignedAt:'2026-08-22T12:00:00.000Z',
    commitHash:'abc1234',
  });
});

test('retries and repeated launches do not increment the same source commit', () => {
  const first = advanceBuildForCommit(null, { commitHash:'abc1234', assignedAt:'2026-08-22T12:00:00.000Z' });
  const retry = advanceBuildForCommit(first, { commitHash:'abc1234', assignedAt:'2026-08-22T12:05:00.000Z' });
  assert.deepEqual(retry, first);
  const nextCommit = advanceBuildForCommit(retry, { commitHash:'def5678', assignedAt:'2026-08-22T12:10:00.000Z' });
  assert.equal(nextCommit.current, '0.0.04');
  assert.equal(nextCommit.history.at(-1).commitHash, 'def5678');
});

test('legacy approval caller remains compatible but no longer requires manual approval', () => {
  const state = approveNextBuild(null, { commitHash:'abc1234', approvedAt:'2026-08-22T12:00:00.000Z' });
  assert.equal(state.current, '0.0.03');
  const retry = approveNextBuild(state, { commitHash:'abc1234', approvedAt:'2026-08-22T12:01:00.000Z' });
  assert.equal(retry.current, '0.0.03');
  assert.equal(retry.history.length, 1);
});

test('legacy zero-padded build numbers are migrated without going backwards', () => {
  const state = normalizeBuildState({
    current:'0.0.09',
    history:[{ number:'0.0.08', approvedAt:'2026-08-22T12:00:00.000Z' }],
  });
  assert.equal(state.current, '0.0.09');
  assert.equal(state.history[0].number, '0.0.08');
  assert.equal(nextBuildNumber(state.current), '0.0.10');
});

test('Settings removes manual approval and bootstrap assigns once per source commit', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
  assert.match(html, /id="approved-build-next"/);
  assert.match(bootstrap, /approve-build-number-btn/);
  assert.match(bootstrap, /\.remove\(\)/);
  assert.match(bootstrap, /autoAssignBuild/);
  assert.match(bootstrap, /assigned automatically once per new Nexus source commit/);
  assert.match(bootstrap, /1\.0\.0 remains reserved for public launch/);
});
