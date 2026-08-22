const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { nextBuildNumber, approveNextBuild, normalizeBuildState } = require('../buildNumber');

test('the first user-approved build starts at 0.0.01 and increments predictably', () => {
  assert.equal(nextBuildNumber(null), '0.0.01');
  assert.equal(nextBuildNumber('0.0.01'), '0.0.02');
  assert.equal(nextBuildNumber('0.0.09'), '0.0.10');
});

test('a build number cannot be assigned without explicit approval', () => {
  assert.throws(() => approveNextBuild(null, { approved:false }), /Explicit user approval/);
  assert.throws(() => approveNextBuild(null), /Explicit user approval/);
});

test('approval records the build, timestamp, and source commit in bounded history', () => {
  const state = approveNextBuild(null, { approved:true, commitHash:'abc1234', approvedAt:'2026-08-22T12:00:00.000Z' });
  assert.equal(state.current, '0.0.01');
  assert.deepEqual(state.history[0], { number:'0.0.01', approvedAt:'2026-08-22T12:00:00.000Z', commitHash:'abc1234' });
  assert.equal(normalizeBuildState(state).current, '0.0.01');
});

test('Settings presents a preview and uses a narrow approval bridge', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(html, /id="approved-build-next"/);
  assert.match(html, /Approve next build number/);
  assert.match(preload, /build-number:approve/);
  assert.match(main, /value\.approved !== true/);
  assert.match(main, /approveNextBuild/);
});
