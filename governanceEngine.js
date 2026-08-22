const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class FlightRecorder {
  constructor(limit = 500) { this.limit = limit; this.events = []; }
  record(event) {
    const item = { timestamp: new Date().toISOString(), ...event };
    this.events.push(item);
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
    return item;
  }
  snapshot() { return [...this.events]; }
  flush(projectRoot, filename = '.nexus.crash') {
    const target = path.join(projectRoot, filename);
    fs.writeFileSync(target, this.events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    return target;
  }
}

class TokenUsageMonitor {
  constructor({ warningUsd = 2, hardKillUsd = 5 } = {}) {
    this.warningUsd = warningUsd;
    this.hardKillUsd = hardKillUsd;
    this.totalUsd = 0;
  }
  addCost(usd) {
    if (!Number.isFinite(usd) || usd < 0) throw new Error('Cost must be a non-negative number');
    this.totalUsd += usd;
    if (this.totalUsd >= this.hardKillUsd) return { status: 'ABORT', totalUsd: this.totalUsd };
    if (this.totalUsd >= this.warningUsd) return { status: 'WARN', totalUsd: this.totalUsd };
    return { status: 'OK', totalUsd: this.totalUsd };
  }
}

class GovernanceSession {
  constructor({ recorder = new FlightRecorder(), budget = new TokenUsageMonitor() } = {}) {
    this.executionId = crypto.randomUUID();
    this.recorder = recorder;
    this.budget = budget;
    this.status = 'RUNNING_UNVERIFIED';
    this.recorder.record({ executionId: this.executionId, eventCode: 'SESSION_START', status: this.status });
  }
  record(eventCode, metadata = {}) {
    return this.recorder.record({ executionId: this.executionId, eventCode, status: this.status, metadata });
  }
  addCost(usd) {
    const result = this.budget.addCost(usd);
    this.record('COST_UPDATE', result);
    if (result.status === 'ABORT') this.status = 'LOCKED_BUDGET';
    return result;
  }
  markVerified() { this.status = 'VERIFIED'; this.record('VERIFICATION_PASS'); }
  markFailed(error) { this.status = 'FAILED'; this.record('VERIFICATION_FAIL', { error: String(error || '') }); }
}

function loadConstitution(projectRoot) {
  const candidates = [path.join(projectRoot, 'CONSTITUTION.md'), path.join(__dirname, 'CONSTITUTION.md')];
  for (const file of candidates) {
    try { return fs.readFileSync(file, 'utf8'); } catch {}
  }
  throw new Error('CONSTITUTION.md not found');
}

module.exports = { FlightRecorder, TokenUsageMonitor, GovernanceSession, loadConstitution };
