const test = require('node:test');
const assert = require('node:assert/strict');
const { FlightRecorder, TokenUsageMonitor, GovernanceSession } = require('../governanceEngine');

test('session starts unverified and only marks verified explicitly', () => {
  const session = new GovernanceSession();
  assert.equal(session.status, 'RUNNING_UNVERIFIED');
  session.markVerified();
  assert.equal(session.status, 'VERIFIED');
});

test('cost monitor warns and hard-aborts', () => {
  const monitor = new TokenUsageMonitor({ warningUsd: 2, hardKillUsd: 5 });
  assert.equal(monitor.addCost(2).status, 'WARN');
  assert.equal(monitor.addCost(3).status, 'ABORT');
});

test('flight recorder is bounded', () => {
  const recorder = new FlightRecorder(2);
  recorder.record({ eventCode: 'A' }); recorder.record({ eventCode: 'B' }); recorder.record({ eventCode: 'C' });
  assert.deepEqual(recorder.snapshot().map((x) => x.eventCode), ['B', 'C']);
});
