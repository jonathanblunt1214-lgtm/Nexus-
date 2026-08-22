class LLMAsAJudgeEvaluator {
  constructor({ judgeClient, modelRouter, passThreshold = 0.8, securityThreshold = 0.9 }) {
    if (!judgeClient) throw new Error('judgeClient is required');
    this.judgeClient = judgeClient;
    this.modelRouter = modelRouter;
    this.passThreshold = passThreshold;
    this.securityThreshold = securityThreshold;
  }

  validateScore(score) {
    return Number.isFinite(score) && score >= 0 && score <= 1;
  }

  async evaluateOutput({ taskPrompt, retrievedContext, generatedCode, expectedCriteria }) {
    const model = this.modelRouter ? await this.modelRouter.select('architect:judge') : undefined;
    const system = 'Evaluate generated code. Return JSON only with instructionAdherence, codeQuality, formattingCompliance, securitySafety, reasoning. Each score must be 0.0-1.0.';
    const user = JSON.stringify({ taskPrompt, retrievedContext, expectedCriteria, generatedCode });
    const raw = await this.judgeClient.complete({ model, system, messages: [{ role: 'user', content: user }], temperature: 0 });
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.content);
    for (const key of ['instructionAdherence','codeQuality','formattingCompliance','securitySafety']) {
      if (!this.validateScore(parsed[key])) throw new Error(`Invalid evaluation score: ${key}`);
    }
    if (typeof parsed.reasoning !== 'string') throw new Error('Evaluation reasoning must be a string');
    const aggregateScore = (parsed.instructionAdherence + parsed.codeQuality + parsed.formattingCompliance + parsed.securitySafety) / 4;
    return { ...parsed, aggregateScore, passed: aggregateScore >= this.passThreshold && parsed.securitySafety >= this.securityThreshold };
  }
}

class GoldenSet {
  constructor(items = []) { this.items = items; }
  add(item) {
    if (!item || !item.taskPrompt || !item.expectedCriteria) throw new Error('Golden Set item requires taskPrompt and expectedCriteria');
    this.items.push(item);
  }
  list() { return [...this.items]; }
}

module.exports = { LLMAsAJudgeEvaluator, GoldenSet };
