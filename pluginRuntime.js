const path = require('path');
const { Worker } = require('worker_threads');

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class PluginRuntime {
  constructor({ capabilityHandlers = {}, timeoutMs = 1000 } = {}) {
    this.capabilityHandlers = { ...capabilityHandlers };
    this.timeoutMs = timeoutMs;
    this.instances = new Map();
    this.nextRequestId = 1;
  }

  _terminate(instance, reason) {
    if (!instance || instance.terminated) return;
    instance.terminated = true;
    clearTimeout(instance.readyTimer);
    for (const pending of instance.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason instanceof Error ? reason : new Error(String(reason || 'Plugin worker terminated')));
    }
    instance.pending.clear();
    try { instance.worker.terminate(); } catch {}
    this.instances.delete(instance.manifest.id);
  }

  _handleWorkerMessage(instance, message, audit) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'audit') {
      audit?.(message.code, cloneJson(message.metadata || {}));
      return;
    }
    if (message.type === 'capability') {
      const { requestId, capability, payload } = message;
      const allowed = new Set(instance.manifest.capabilities || []);
      const reply = (ok, value) => {
        if (!instance.terminated) instance.worker.postMessage({ type: 'capabilityResult', requestId, ok, value: cloneJson(value) });
      };
      if (!allowed.has(capability)) {
        reply(false, `Plugin capability denied: ${capability}`);
        return;
      }
      const handler = this.capabilityHandlers[capability];
      if (typeof handler !== 'function') {
        reply(false, `Capability unavailable: ${capability}`);
        return;
      }
      audit?.('PLUGIN_CAPABILITY_CALL', { capability });
      Promise.resolve()
        .then(() => handler(cloneJson(payload), { pluginId: instance.manifest.id }))
        .then((value) => reply(true, value))
        .catch((error) => reply(false, error?.message || String(error)));
      return;
    }
    if (message.type === 'ready') {
      instance.readyResolve?.(true);
      instance.readyResolve = null;
      instance.readyReject = null;
      return;
    }
    if (message.type === 'loadError') {
      instance.readyReject?.(new Error(message.error || 'Plugin failed to load'));
      instance.readyResolve = null;
      instance.readyReject = null;
      return;
    }
    if (message.type === 'result') {
      const pending = instance.pending.get(message.requestId);
      if (!pending) return;
      instance.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(cloneJson(message.value));
      else pending.reject(new Error(message.error || 'Plugin command failed'));
    }
  }

  async load({ manifest, pluginRoot, audit }) {
    if (this.instances.has(manifest.id)) throw new Error(`Plugin already loaded: ${manifest.id}`);
    const root = path.resolve(pluginRoot);
    const startupTimeoutMs = Math.max(5000, this.timeoutMs + 250);
    const worker = new Worker(path.join(__dirname, 'pluginWorker.js'), {
      workerData: { manifest: cloneJson(manifest), pluginRoot: root, timeoutMs: this.timeoutMs, startupTimeoutMs },
    });
    const instance = {
      manifest: cloneJson(manifest),
      pluginRoot: root,
      worker,
      active: false,
      loadedAt: Date.now(),
      lastHeartbeat: Date.now(),
      pending: new Map(),
      terminated: false,
      readyResolve: null,
      readyReject: null,
      readyTimer: null,
    };
    this.instances.set(manifest.id, instance);

    const ready = new Promise((resolve, reject) => {
      instance.readyResolve = resolve;
      instance.readyReject = reject;
      // Worker startup competes for CPU during builds and large test runs. Keep
      // the strict per-handler timeout below, but do not mistake scheduler
      // contention for malicious plug-in code before the worker is even ready.
      instance.readyTimer = setTimeout(() => reject(new Error(`Plugin load timed out after ${startupTimeoutMs}ms`)), startupTimeoutMs);
    });
    worker.on('message', (message) => this._handleWorkerMessage(instance, message, audit));
    worker.on('error', (error) => instance.readyReject?.(error));
    worker.on('exit', (code) => {
      if (!instance.terminated && code !== 0) this._terminate(instance, new Error(`Plugin worker exited unexpectedly with code ${code}`));
    });

    try {
      await ready;
      clearTimeout(instance.readyTimer);
      audit?.('PLUGIN_LOADED', { version: manifest.version, isolation: 'worker_thread' });
      return instance;
    } catch (error) {
      this._terminate(instance, error);
      throw error;
    }
  }

  _command(instance, command, payload = {}, audit) {
    if (!instance || instance.terminated) return Promise.reject(new Error('Plugin worker is not available'));
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        instance.pending.delete(requestId);
        const error = new Error(`Plugin ${command} timed out after ${this.timeoutMs}ms`);
        audit?.('PLUGIN_TIMEOUT', { command, timeoutMs: this.timeoutMs });
        this._terminate(instance, error);
        reject(error);
      }, this.timeoutMs);
      instance.pending.set(requestId, { resolve, reject, timer });
      instance.worker.postMessage({ type: 'command', requestId, command, payload: cloneJson(payload) });
    });
  }

  async activate(pluginId, audit) {
    const instance = this.instances.get(pluginId);
    if (!instance) throw new Error(`Plugin not loaded: ${pluginId}`);
    if (instance.active) return true;
    await this._command(instance, 'activate', {}, audit);
    instance.active = true;
    instance.lastHeartbeat = Date.now();
    audit?.('PLUGIN_ACTIVATED', {});
    return true;
  }

  async deactivate(pluginId, audit) {
    const instance = this.instances.get(pluginId);
    if (!instance) return false;
    if (instance.active) await this._command(instance, 'deactivate', {}, audit);
    instance.active = false;
    instance.lastHeartbeat = Date.now();
    audit?.('PLUGIN_DEACTIVATED', {});
    return true;
  }

  async invokeSlot(pluginId, slotName, payload, audit) {
    const instance = this.instances.get(pluginId);
    if (!instance || !instance.active) throw new Error(`Plugin is not active: ${pluginId}`);
    const result = await this._command(instance, 'invokeSlot', { slotName, payload: cloneJson(payload) }, audit);
    instance.lastHeartbeat = Date.now();
    audit?.('PLUGIN_SLOT_INVOKED', { slotName });
    return cloneJson(result);
  }

  health(pluginId, staleAfterMs = 30000) {
    const instance = this.instances.get(pluginId);
    if (!instance || instance.terminated) return { status: 'NOT_LOADED' };
    if (!instance.active) return { status: 'INACTIVE', lastHeartbeat: instance.lastHeartbeat, isolation: 'worker_thread' };
    const ageMs = Date.now() - instance.lastHeartbeat;
    return { status: ageMs > staleAfterMs ? 'STALE' : 'HEALTHY', ageMs, lastHeartbeat: instance.lastHeartbeat, isolation: 'worker_thread' };
  }

  unload(pluginId) {
    const instance = this.instances.get(pluginId);
    if (!instance) return false;
    this._terminate(instance, new Error('Plugin unloaded'));
    return true;
  }
}

module.exports = { PluginRuntime, cloneJson };
