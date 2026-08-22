const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');
const { RuntimeDebugger, resolveInsideWorkspace, validateExpression, validateInspectorUrl } = require('../runtimeDebugger');

function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stderr = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => { child.emit('exit', 0); return true; };
  return child;
}

test('debug target path cannot escape workspace', () => {
  const root = path.join(process.cwd(), 'workspace');
  assert.equal(resolveInsideWorkspace(root, '../outside.js'), null);
});

test('debugger launches only a new isolated inspected process', () => {
  let seenArgs;
  const child = fakeChild();
  const debuggerCtl = new RuntimeDebugger({
    workspaceRoot: process.cwd(),
    spawnImpl: (_bin, args) => { seenArgs = args; return child; },
  });
  const result = debuggerCtl.launchIsolated('test/runtimeDebugger.test.js');
  assert.equal(result.pid, 4242);
  assert.equal(seenArgs[0], '--inspect-brk=127.0.0.1:0');
  assert.notEqual(result.pid, process.pid);
});

test('evaluation only permits a side-effect-minimized expression subset', () => {
  assert.equal(validateExpression('state.user.name'), 'state.user.name');
  assert.equal(validateExpression('JSON.stringify(state)'), 'JSON.stringify(state)');
  assert.throws(() => validateExpression('process.exit()'), /safe debugger evaluation subset/);
  assert.throws(() => validateExpression('x = 1'), /safe debugger evaluation subset/);
});

test('Nexus main process can never be used as a debugger target', () => {
  const child = fakeChild(process.pid);
  const debuggerCtl = new RuntimeDebugger({ workspaceRoot: process.cwd(), spawnImpl: () => child });
  const target = debuggerCtl.launchIsolated('test/runtimeDebugger.test.js');
  assert.throws(() => debuggerCtl.prepareEvaluation(target.id, process.pid, 'state'), /main process is forbidden/);
});

test('attach targets are limited to localhost and never the Nexus process', async () => {
  assert.match(validateInspectorUrl('ws://127.0.0.1:9229/id'), /^ws:\/\/127\.0\.0\.1/);
  assert.throws(() => validateInspectorUrl('ws://example.com:9229/id'), /limited to localhost/);
  const debuggerCtl = new RuntimeDebugger({ workspaceRoot: process.cwd() });
  await assert.rejects(() => debuggerCtl.attachLocal(process.pid, 'ws://127.0.0.1:9229/id'), /forbidden debugger PID/);
});
