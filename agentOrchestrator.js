const STATES = Object.freeze({
  IDLE: 'IDLE',
  PLANNING: 'PLANNING',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  CORRECTING: 'CORRECTING',
  FINISHED: 'FINISHED',
  LOCKED: 'LOCKED',
});

class AgentOrchestrator {
  constructor({ architect, editor, verifier, approvalGate, maxCorrections = 3 }) {
    if (!architect || !editor || !verifier || !approvalGate) throw new Error('architect, editor, verifier, and approvalGate are required');
    this.architect = architect;
    this.editor = editor;
    this.verifier = verifier;
    this.approvalGate = approvalGate;
    this.maxCorrections = maxCorrections;
    this.reset();
  }

  reset() {
    this.state = STATES.IDLE;
    this.iteration = 0;
    this.consecutiveCorrections = 0;
    this.lastError = null;
    this.plan = null;
    this.history = [];
  }

  snapshot(extra = {}) {
    return {
      state: this.state,
      iteration: this.iteration,
      lastError: this.lastError,
      plan: this.plan,
      history: [...this.history],
      ...extra,
    };
  }

  async run(task, context = {}) {
    if (this.state !== STATES.IDLE) throw new Error(`Agent is not idle (state=${this.state})`);
    let workingContext = { ...context };

    while (true) {
      this.iteration += 1;
      this.state = this.consecutiveCorrections > 0 ? STATES.CORRECTING : STATES.PLANNING;
      this.plan = await this.architect.plan(task, workingContext, this.snapshot());
      this.history.push({ state: this.state, iteration: this.iteration, plan: this.plan });

      this.state = STATES.EXECUTING;
      const proposal = await this.editor.propose(this.plan, workingContext, this.snapshot());

      const approval = await this.approvalGate.request({ task, plan: this.plan, proposal, iteration: this.iteration });
      if (!approval || approval.approved !== true) {
        this.state = STATES.LOCKED;
        this.lastError = 'Human approval required before file mutation.';
        return this.snapshot({ approved: false, proposal });
      }

      const applied = await this.editor.applyApproved(proposal, approval, this.snapshot());
      this.state = STATES.VERIFYING;
      const verification = await this.verifier.verify(applied, { task, plan: this.plan, context: workingContext });
      this.history.push({ state: STATES.VERIFYING, iteration: this.iteration, verification });

      if (verification && verification.passed === true) {
        this.state = STATES.FINISHED;
        this.consecutiveCorrections = 0;
        return this.snapshot({ approved: true, result: applied, verification });
      }

      this.consecutiveCorrections += 1;
      this.lastError = verification?.error || 'Verification failed.';
      workingContext = {
        ...workingContext,
        correctionFeedback: verification,
        previousPlan: this.plan,
      };

      if (this.consecutiveCorrections >= this.maxCorrections) {
        this.state = STATES.LOCKED;
        return this.snapshot({
          approved: true,
          verification,
          requiresHumanIntervention: true,
          reason: `Verification failed ${this.consecutiveCorrections} consecutive times.`,
        });
      }
    }
  }
}

module.exports = { AgentOrchestrator, STATES };
