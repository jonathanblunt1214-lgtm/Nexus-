const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const { DebugAdapterSession } = require('../debugAdapter');

function fakeAdapter() {
  const child = { pid: 42, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} };
  return child;
}

test('Debug Adapter Protocol uses framed requests and resolves responses', async () => {
  const child = fakeAdapter();
  let written = '';
  child.stdin.on('data', (chunk) => { written += chunk; });
  const session = new DebugAdapterSession({ workspaceRoot: process.cwd(), command: process.execPath, spawnImpl: () => child });
  const request = session.threads();
  assert.match(written, /Content-Length:/);
  assert.match(written, /"command":"threads"/);
  const response = JSON.stringify({ seq: 2, type: 'response', request_seq: 1, success: true, command: 'threads', body: { threads: [{ id: 1, name: 'main' }] } });
  child.stdout.write(`Content-Length: ${Buffer.byteLength(response)}\r\n\r\n${response}`);
  assert.deepEqual(await request, { threads: [{ id: 1, name: 'main' }] });
});

test('Debug adapters require an explicit absolute executable', () => {
  assert.throws(() => new DebugAdapterSession({ workspaceRoot: process.cwd(), command: 'debugpy-adapter' }), /absolute executable/);
});
