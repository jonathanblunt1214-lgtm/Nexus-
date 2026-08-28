const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('AI-HANDOFF.json documents the agent communication timestamp policy and AI conflict governance in plain language', () => {
  const handoff = JSON.parse(read('AI-HANDOFF.json'));
  assert.equal(handoff.schemaVersion, 1);
  assert.equal(handoff.agentCommunicationPolicy.requireTimestampOnCheckIns, true);
  assert.equal(handoff.agentCommunicationPolicy.timestampFormat, 'YYYY-MM-DD HH:MM:SS EDT/EST');
  assert.match(handoff.agentCommunicationPolicy.appliesTo, /progress or completion check-in/);
  assert.match(handoff.agentCommunicationPolicy.summary, /2026-08-28 08:10:42 EDT/);
  assert.equal(handoff.aiConflictGovernance.reference, 'AI-CONFLICTS.json');
  assert.match(handoff.aiConflictGovernance.summary, /blocks The Crucible/);
  assert.match(handoff.branchAuthoritySummary, /Development-branch/);
});

test('AGENTS.md points every agent at AI-HANDOFF.json and states the check-in timestamp policy', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /`AI-HANDOFF\.json` is the plain-language index/);
  assert.match(agents, /`DEVLOG\.md` is the human-readable equivalent/);
  assert.match(agents, /## Agent communication policy/);
  assert.match(agents, /YYYY-MM-DD HH:MM:SS EDT\/EST/);
});

test('DEVLOG.md carries plain-language summaries of both the conflict governance and the communication policy', () => {
  const devlog = read('DEVLOG.md');
  assert.match(devlog, /## Plain-language: AI conflict governance/);
  assert.match(devlog, /## Plain-language: agent communication policy/);
  assert.match(devlog, /YYYY-MM-DD HH:MM:SS EDT\/EST/);
  assert.match(devlog, /AI-CONFLICTS\.json/);
  assert.match(devlog, /AI-HANDOFF\.json/);
});
