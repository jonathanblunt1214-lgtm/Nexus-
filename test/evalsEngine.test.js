const test = require('node:test');
const assert = require('node:assert/strict');
const { LLMAsAJudgeEvaluator, GoldenSet } = require('../evalsEngine');

test('judge enforces aggregate and security thresholds', async () => {
  const judgeClient = { complete: async () => ({ content: JSON.stringify({ instructionAdherence:0.9, codeQuality:0.9, formattingCompliance:0.9, securitySafety:0.89, reasoning:'ok' }) }) };
  const evaluator = new LLMAsAJudgeEvaluator({ judgeClient });
  const result = await evaluator.evaluateOutput({ taskPrompt:'t', retrievedContext:'c', generatedCode:'x', expectedCriteria:'e' });
  assert.equal(result.passed, false);
});

test('judge uses model router instead of hardcoded vendor model', async () => {
  let seenModel;
  const evaluator = new LLMAsAJudgeEvaluator({
    modelRouter: { select: async () => 'configured-judge-model' },
    judgeClient: { complete: async (req) => { seenModel = req.model; return { content: JSON.stringify({ instructionAdherence:1, codeQuality:1, formattingCompliance:1, securitySafety:1, reasoning:'pass' }) }; } },
  });
  const result = await evaluator.evaluateOutput({ taskPrompt:'t', retrievedContext:'c', generatedCode:'x', expectedCriteria:'e' });
  assert.equal(seenModel, 'configured-judge-model');
  assert.equal(result.passed, true);
});

test('golden set validates required fields', () => {
  const set = new GoldenSet();
  assert.throws(() => set.add({ taskPrompt:'x' }));
  set.add({ taskPrompt:'x', expectedCriteria:'y' });
  assert.equal(set.list().length, 1);
});
