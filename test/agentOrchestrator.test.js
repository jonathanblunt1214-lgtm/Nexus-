const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentOrchestrator, STATES } = require('../agentOrchestrator');

test('approval gate blocks mutation', async () => {
  let applied = false;
  const agent = new AgentOrchestrator({
    architect: { plan: async () => ({ files: ['a.js'] }) },
    editor: { propose: async () => ({ diff: 'x' }), applyApproved: async () => { applied = true; } },
    verifier: { verify: async () => ({ passed: true }) },
    approvalGate: { request: async () => ({ approved: false }) },
  });
  const result = await agent.run('task');
  assert.equal(result.state, STATES.LOCKED);
  assert.equal(applied, false);
});

test('verification feedback self-corrects and finishes', async () => {
  let verifies = 0;
  const agent = new AgentOrchestrator({
    architect: { plan: async (_task, ctx) => ({ corrected: !!ctx.correctionFeedback }) },
    editor: { propose: async (plan) => plan, applyApproved: async (proposal) => proposal },
    verifier: { verify: async () => (++verifies === 1 ? { passed: false, error: 'compile error' } : { passed: true }) },
    approvalGate: { request: async () => ({ approved: true }) },
  });
  const result = await agent.run('task');
  assert.equal(result.state, STATES.FINISHED);
  assert.equal(result.iteration, 2);
  assert.equal(result.plan.corrected, true);
});

test('three consecutive failures lock for human intervention', async () => {
  const agent = new AgentOrchestrator({
    architect: { plan: async () => ({}) },
    editor: { propose: async () => ({}), applyApproved: async () => ({}) },
    verifier: { verify: async () => ({ passed: false, error: 'still broken' }) },
    approvalGate: { request: async () => ({ approved: true }) },
  });
  const result = await agent.run('task');
  assert.equal(result.state, STATES.LOCKED);
  assert.equal(result.iteration, 3);
  assert.equal(result.requiresHumanIntervention, true);
});
