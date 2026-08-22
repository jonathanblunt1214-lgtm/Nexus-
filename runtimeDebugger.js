const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const SAFE_EXPRESSION = /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|JSON\.stringify\([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\))$/;

function resolveInsideWorkspace(workspaceRoot, candidate) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, candidate);
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

function validateExpression(expression) {
  if (typeof expression !== 'string' || !expression.trim()) throw new Error('Expression is required');
  const value = expression.trim();
  if (value.length > 300 || !SAFE_EXPRESSION.test(value)) {
    throw new Error('Expression is outside the safe debugger evaluation subset');
  }
  return value;
}

function validateInspectorUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('A valid inspector WebSocket URL is required'); }
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('Debugger attachment is limited to localhost inspector targets');
  return url.toString();
}

class InspectorSession {
  constructor(url, WebSocketImpl = globalThis.WebSocket) {
    if (!WebSocketImpl) throw new Error('WebSocket support is unavailable');
    this.url = validateInspectorUrl(url);
    this.socket = new WebSocketImpl(this.url);
    this.sequence = 0;
    this.pending = new Map();
    this.events = [];
    this.paused = null;
    this.scripts = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('Could not connect to debugger target')), { once: true });
    });
    this.socket.addEventListener('message', (event) => this.onMessage(event.data));
  }

  onMessage(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (pending) { this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result || {}); }
      return;
    }
    if (message.method === 'Debugger.paused') this.paused = message.params;
    if (message.method === 'Debugger.resumed') this.paused = null;
    if (message.method === 'Debugger.scriptParsed') this.scripts.set(message.params.scriptId, message.params);
    this.events.push({ method: message.method, params: message.params, at: Date.now() });
    if (this.events.length > 300) this.events.shift();
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.sequence;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async initialize() { await this.send('Runtime.enable'); await this.send('Debugger.enable'); return this.snapshot(); }
  snapshot() {
    return {
      paused: Boolean(this.paused), reason: this.paused?.reason || null,
      callFrames: (this.paused?.callFrames || []).map((frame) => ({ id: frame.callFrameId, functionName: frame.functionName || '(anonymous)', url: frame.url, line: frame.location.lineNumber + 1, column: frame.location.columnNumber + 1, scopes: frame.scopeChain.map((scope) => ({ type: scope.type, name: scope.name, objectId: scope.object.objectId, description: scope.object.description })) })),
      scripts: [...this.scripts.values()].filter((script) => script.url).map((script) => ({ id: script.scriptId, url: script.url, sourceMapUrl: script.sourceMapURL || null })),
      events: this.events.slice(-50),
    };
  }
  close() { this.socket.close(); }
}

class RuntimeDebugger {
  constructor({ workspaceRoot, nodeBinary = process.execPath, spawnImpl = spawn, WebSocketImpl = globalThis.WebSocket } = {}) {
    if (!workspaceRoot) throw new Error('workspaceRoot is required');
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.nodeBinary = nodeBinary;
    this.spawnImpl = spawnImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.targets = new Map();
  }

  launchIsolated(scriptPath, args = []) {
    const resolvedScript = resolveInsideWorkspace(this.workspaceRoot, scriptPath);
    if (!resolvedScript) throw new Error('Debug target must be inside the active workspace');
    if (!Array.isArray(args) || args.some((x) => typeof x !== 'string' || x.length > 1000)) throw new Error('Invalid debug target arguments');

    const id = `dbg_${crypto.randomUUID()}`;
    const child = this.spawnImpl(this.nodeBinary, ['--inspect-brk=127.0.0.1:0', resolvedScript, ...args], {
      cwd: this.workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NEXUS_DEBUG_TARGET: '1' },
    });

    this.targets.set(id, { id, pid: child.pid, child, scriptPath: resolvedScript, createdAt: Date.now(), debugUrl: null, closed: false });
    const parseInspectorUrl = (chunk) => {
      const text = String(chunk || '');
      const match = text.match(/ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+/i);
      if (match) this.targets.get(id).debugUrl = match[0];
    };
    child.stderr?.on('data', parseInspectorUrl);
    child.once('exit', () => { const target = this.targets.get(id); if (target) target.closed = true; });

    return { id, pid: child.pid, state: 'RUNNING_UNVERIFIED' };
  }

  getTarget(id) {
    const target = this.targets.get(id);
    if (!target) throw new Error('Unknown debugger target');
    return { id: target.id, pid: target.pid, scriptPath: target.scriptPath, debugUrl: target.debugUrl, closed: target.closed, createdAt: target.createdAt };
  }

  assertIsolatedTarget(id, pid) {
    const target = this.targets.get(id);
    if (!target || target.closed) throw new Error('Debugger target is not active');
    if (target.pid !== pid) throw new Error('Debugger PID mismatch');
    if (pid === process.pid) throw new Error('Attaching to the Nexus main process is forbidden');
    return target;
  }

  prepareEvaluation(id, pid, expression) {
    const target = this.assertIsolatedTarget(id, pid);
    return {
      targetId: id,
      pid: target.pid,
      debugUrl: target.debugUrl,
      expression: validateExpression(expression),
      returnByValue: true,
      awaitPromise: false,
      sideEffectFreeOnly: true,
    };
  }

  stop(id) {
    const target = this.targets.get(id);
    if (!target) return false;
    target.session?.close();
    if (!target.closed && target.child) target.child.kill('SIGTERM');
    target.closed = true;
    return true;
  }

  async connect(id) {
    const target = this.targets.get(id);
    if (!target?.debugUrl) throw new Error('Inspector URL is not ready yet');
    if (!target.session) { target.session = new InspectorSession(target.debugUrl, this.WebSocketImpl); await target.session.initialize(); }
    return target.session.snapshot();
  }

  async attachLocal(pid, debugUrl) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('Invalid or forbidden debugger PID');
    const id = `dbg_${crypto.randomUUID()}`;
    const target = { id, pid, child: null, scriptPath: null, createdAt: Date.now(), debugUrl: validateInspectorUrl(debugUrl), closed: false, attached: true };
    this.targets.set(id, target);
    await this.connect(id);
    return { id, pid, state: 'ATTACHED' };
  }

  session(id) { const target = this.targets.get(id); if (!target?.session) throw new Error('Debugger target is not connected'); return target.session; }
  async setBreakpoint(id, url, line, column = 0, condition = '') { return this.session(id).send('Debugger.setBreakpointByUrl', { url, lineNumber: Math.max(0, Number(line) - 1), columnNumber: Math.max(0, Number(column)), condition: String(condition || '') }); }
  async removeBreakpoint(id, breakpointId) { return this.session(id).send('Debugger.removeBreakpoint', { breakpointId }); }
  async control(id, action) { const methods = { resume: 'Debugger.resume', pause: 'Debugger.pause', over: 'Debugger.stepOver', into: 'Debugger.stepInto', out: 'Debugger.stepOut' }; if (!methods[action]) throw new Error('Invalid debugger action'); await this.session(id).send(methods[action]); return { ok: true }; }
  async setExceptionMode(id, mode) { if (!['none', 'uncaught', 'all'].includes(mode)) throw new Error('Invalid exception mode'); await this.session(id).send('Debugger.setPauseOnExceptions', { state: mode }); return { ok: true }; }
  async properties(id, objectId) { const result = await this.session(id).send('Runtime.getProperties', { objectId, ownProperties: true, generatePreview: true }); return { properties: (result.result || []).map((item) => ({ name: item.name, type: item.value?.type, value: item.value?.value, description: item.value?.description, objectId: item.value?.objectId })) }; }
  async evaluate(id, callFrameId, expression) { return this.session(id).send('Debugger.evaluateOnCallFrame', { callFrameId, expression: validateExpression(expression), returnByValue: true, throwOnSideEffect: true }); }
  snapshot(id) { return this.session(id).snapshot(); }
}

module.exports = { RuntimeDebugger, InspectorSession, resolveInsideWorkspace, validateExpression, validateInspectorUrl, SAFE_EXPRESSION };
