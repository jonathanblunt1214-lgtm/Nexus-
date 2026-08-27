const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('every AI is restricted to literal Development-branch without an exact owner exception', () => {
  const agents = read('AGENTS.md');
  const claude = read('CLAUDE.md');

  assert.match(agents, /Development-branch` is the only branch/);
  assert.match(agents, /must not create, update, or use `claude\/\*`/);
  assert.match(agents, /explicitly authorizes that exact branch in the current conversation/);
  assert.match(agents, /Permission for one exception expires/);
  assert.match(agents, /AI branch scope - development only/);
  assert.match(agents, /It has no bypass actors/);

  assert.match(claude, /Read and follow `AGENTS\.md`/);
  assert.match(claude, /Do all ordinary work directly on literal `Development-branch`/);
  assert.match(claude, /Do not create or update `claude\/\*`/);
  assert.match(claude, /Shared owner credentials do not grant an AI owner authority/);
  assert.match(claude, /Never create a temporary synchronization branch or PR/);
  assert.doesNotMatch(claude, /Disable auto-merge on that one PR/);
});
