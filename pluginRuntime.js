const fs = require('fs');
const vm = require('vm');
const path = require('path');

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class PluginRuntime {
  constructor({ capabilityHandlers = {}, timeoutMs = 1000 } = {}) {
    this.capabilityHandlers = { ...capabilityHandlers };
    this.timeoutMs = timeoutMs;
    this.instances = new Map();
  }

  createApi(manifest, audit) {
    const allowed = new Set(manifest.capabilities || []);
    return Object.freeze({
      manifest: Object.freeze({ id: manifest.id, name: manifest.name, version: manifest.version }),
      call: async (capability, payload) => {
        if (!allowed.has(capability)) throw new Error(`Plugin capability denied: ${capability}`);
        const handler = this.capabilityHandlers[capability];
        if (typeof handler !== 'function') throw new Error(`Capability unavailable: ${capability}`);
        audit?.('PLUGIN_CAPABILITY_CALL', { capability });
        return cloneJson(await handler(cloneJson(payload), { pluginId: manifest.id }));
      },
      emitTelemetry: (event, metadata = {}) => {
        if (!allowed.has('telemetry:emit')) throw new Error('Plugin capability denied: telemetry:emit');
        audit?.('PLUGIN_TELEMETRY', { event: String(event || '').slice(0, 120), metadata: cloneJson(metadata) });
      },
    });
  }

  load({ manifest, pluginRoot, audit }) {
    if (this.instances.has(manifest.id)) throw new Error(`Plugin already loaded: ${manifest.id}`);
    const entryPath = path.resolve(pluginRoot, manifest.entry);
    const root = path.resolve(pluginRoot);
    if (!(entryPath === root || entryPath.startsWith(root + path.sep))) throw new Error('Plugin entry escapes plugin root');
    const source = fs.readFileSync(entryPath, 'utf8');
    if (source.length > 1024 * 1024) throw new Error('Plugin entry exceeds 1 MiB limit');

    let registration = null;
    const register = (definition) => {
      if (registration) throw new Error('Plugin may register only once');
      if (!definition || typeof definition !== 'object') throw new Error('Plugin registration must be an object');
      const slotHandlers = definition.slots && typeof definition.slots === 'object' ? definition.slots : {};
      registration = {
        onActivate: typeof definition.onActivate === 'function' ? definition.onActivate : null,
        onDeactivate: typeof definition.onDeactivate === 'function' ? definition.onDeactivate : null,
        slots: slotHandlers,
      };
    };

    const sandbox = Object.create(null);
    Object.assign(sandbox, {
      register,
      nexus: this.createApi(manifest, audit),
      console: Object.freeze({
        log: (...args) => audit?.('PLUGIN_LOG', { level: 'log', message: args.map(String).join(' ').slice(0, 2000) }),
        warn: (...args) => audit?.('PLUGIN_LOG', { level: 'warn', message: args.map(String).join(' ').slice(0, 2000) }),
        error: (...args) => audit?.('PLUGIN_LOG', { level: 'error', message: args.map(String).join(' ').slice(0, 2000) }),
      }),
    });
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox, { name: `nexus-plugin:${manifest.id}`, codeGeneration: { strings: false, wasm: false } });
    const script = new vm.Script(`"use strict";\n${source}`, { filename: entryPath });
    script.runInContext(context, { timeout: this.timeoutMs });
    if (!registration) throw new Error('Plugin did not call register(...)');

    for (const slotName of Object.keys(registration.slots)) {
      if (!manifest.slots.includes(slotName)) throw new Error(`Plugin registered undeclared slot: ${slotName}`);
      if (typeof registration.slots[slotName] !== 'function') throw new Error(`Slot handler must be a function: ${slotName}`);
    }

    const instance = { manifest, pluginRoot: root, registration, active: false, loadedAt: Date.now(), lastHeartbeat: Date.now() };
    this.instances.set(manifest.id, instance);
    audit?.('PLUGIN_LOADED', { version: manifest.version });
    return instance;
  }

  async activate(pluginId, audit) {
    const instance = this.instances.get(pluginId);
    if (!instance) throw new Error(`Plugin not loaded: ${pluginId}`);
    if (instance.active) return true;
    if (instance.registration.onActivate) await instance.registration.onActivate();
    instance.active = true;
    instance.lastHeartbeat = Date.now();
    audit?.('PLUGIN_ACTIVATED', {});
    return true;
  }

  async deactivate(pluginId, audit) {
    const instance = this.instances.get(pluginId);
    if (!instance) return false;
    if (instance.active && instance.registration.onDeactivate) await instance.registration.onDeactivate();
    instance.active = false;
    audit?.('PLUGIN_DEACTIVATED', {});
    return true;
  }

  async invokeSlot(pluginId, slotName, payload, audit) {
    const instance = this.instances.get(pluginId);
    if (!instance || !instance.active) throw new Error(`Plugin is not active: ${pluginId}`);
    const handler = instance.registration.slots[slotName];
    if (typeof handler !== 'function') throw new Error(`Plugin does not implement slot: ${slotName}`);
    const result = await handler(cloneJson(payload));
    instance.lastHeartbeat = Date.now();
    audit?.('PLUGIN_SLOT_INVOKED', { slotName });
    return cloneJson(result);
  }

  health(pluginId, staleAfterMs = 30000) {
    const instance = this.instances.get(pluginId);
    if (!instance) return { status: 'NOT_LOADED' };
    if (!instance.active) return { status: 'INACTIVE', lastHeartbeat: instance.lastHeartbeat };
    const ageMs = Date.now() - instance.lastHeartbeat;
    return { status: ageMs > staleAfterMs ? 'STALE' : 'HEALTHY', ageMs, lastHeartbeat: instance.lastHeartbeat };
  }

  unload(pluginId) {
    return this.instances.delete(pluginId);
  }
}

module.exports = { PluginRuntime, cloneJson };
