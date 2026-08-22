const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

class DebugAdapterSession {
  constructor({ workspaceRoot, command, args = [], spawnImpl = spawn }) {
    if (!path.isAbsolute(command || '')) throw new Error('Debug adapter command must be an absolute executable path');
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error('Invalid adapter arguments');
    this.id = `dap_${crypto.randomUUID()}`;
    this.sequence = 0;
    this.pending = new Map();
    this.events = [];
    this.buffer = Buffer.alloc(0);
    this.child = spawnImpl(command, args, { cwd: path.resolve(workspaceRoot), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, NEXUS_DEBUG_ADAPTER: '1' } });
    this.child.stdout.on('data', (chunk) => this.consume(chunk));
    this.child.stderr.on('data', (chunk) => this.events.push({ event: 'adapterOutput', body: { output: String(chunk) } }));
  }
  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const match = this.buffer.subarray(0, headerEnd).toString().match(/Content-Length:\s*(\d+)/i);
      if (!match) throw new Error('Invalid Debug Adapter Protocol frame');
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const message = JSON.parse(this.buffer.subarray(bodyStart, bodyStart + length).toString());
      this.buffer = this.buffer.subarray(bodyStart + length);
      if (message.type === 'response') { const pending = this.pending.get(message.request_seq); if (pending) { this.pending.delete(message.request_seq); message.success ? pending.resolve(message.body || {}) : pending.reject(new Error(message.message || 'Debug adapter request failed')); } }
      else if (message.type === 'event') { this.events.push(message); if (this.events.length > 300) this.events.shift(); }
    }
  }
  request(command, args = {}) {
    const seq = ++this.sequence;
    const message = JSON.stringify({ seq, type: 'request', command, arguments: args });
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
    return new Promise((resolve, reject) => this.pending.set(seq, { resolve, reject }));
  }
  async initialize(adapterId = 'nexus') { return this.request('initialize', { clientID: 'nexus', clientName: 'Nexus', adapterID: adapterId, pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true, supportsRunInTerminalRequest: false }); }
  async launch(configuration) { await this.request(configuration.request === 'attach' ? 'attach' : 'launch', configuration); await this.request('configurationDone'); return { ok: true }; }
  async setBreakpoints(source, breakpoints) { return this.request('setBreakpoints', { source: { path: source }, breakpoints }); }
  control(command, threadId) { const names = { resume: 'continue', pause: 'pause', over: 'next', into: 'stepIn', out: 'stepOut' }; if (!names[command]) throw new Error('Invalid adapter control action'); return this.request(names[command], { threadId }); }
  threads() { return this.request('threads'); }
  stackTrace(threadId) { return this.request('stackTrace', { threadId }); }
  scopes(frameId) { return this.request('scopes', { frameId }); }
  variables(variablesReference) { return this.request('variables', { variablesReference }); }
  evaluate(expression, frameId) { return this.request('evaluate', { expression, frameId, context: 'watch' }); }
  snapshot() { return { id: this.id, pid: this.child.pid, events: this.events.slice(-100) }; }
  stop() { try { this.request('disconnect', { terminateDebuggee: true }); } finally { this.child.kill('SIGTERM'); } }
}

module.exports = { DebugAdapterSession };
