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

class RuntimeDebugger {
  constructor({ workspaceRoot, nodeBinary = process.execPath, spawnImpl = spawn } = {}) {
    if (!workspaceRoot) throw new Error('workspaceRoot is required');
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.nodeBinary = nodeBinary;
    this.spawnImpl = spawnImpl;
    this.targets = new Map();
  }

  launchIsolated(scriptPath, args = []) {
    const resolvedScript = resolveInsideWorkspace(this.workspaceRoot, scriptPath);
    if (!resolvedScript) throw new Error('Debug target must be inside the active workspace');
    if (!Array.isArray(args) || args.some((x) => typeof x !== 'string' || x.length > 1000)) throw new Error('Invalid debug target arguments');

    const id = `dbg_${crypto.randomUUID()}`;
    const child = this.spawnImpl(this.nodeBinary, ['--inspect=127.0.0.1:0', resolvedScript, ...args], {
      cwd: this.workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env, NEXUS_DEBUG_TARGET: '1' },
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
    if (!target.closed) target.child.kill('SIGTERM');
    target.closed = true;
    return true;
  }
}

module.exports = { RuntimeDebugger, resolveInsideWorkspace, validateExpression, SAFE_EXPRESSION };
