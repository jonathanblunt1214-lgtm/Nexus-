const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parentPort, workerData } = require('worker_threads');

const { manifest, pluginRoot, timeoutMs, startupTimeoutMs } = workerData;
let registration = null;
let active = false;
let nextCapabilityId = 1;
const capabilityPending = new Map();

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function audit(code, metadata = {}) {
  parentPort.postMessage({ type: 'audit', code, metadata: cloneJson(metadata) });
}

function capabilityCall(capability, payload) {
  return new Promise((resolve, reject) => {
    const requestId = nextCapabilityId++;
    capabilityPending.set(requestId, { resolve, reject });
    parentPort.postMessage({ type: 'capability', requestId, capability, payload: cloneJson(payload) });
  });
}

function createApi() {
  return Object.freeze({
    manifest: Object.freeze({ id: manifest.id, name: manifest.name, version: manifest.version }),
    call: capabilityCall,
    emitTelemetry: (event, metadata = {}) => {
      if (!(manifest.capabilities || []).includes('telemetry:emit')) throw new Error('Plugin capability denied: telemetry:emit');
      audit('PLUGIN_TELEMETRY', { event: String(event || '').slice(0, 120), metadata: cloneJson(metadata) });
    },
  });
}

function loadPlugin() {
  const root = path.resolve(pluginRoot);
  const entryPath = path.resolve(root, manifest.entry);
  if (!(entryPath === root || entryPath.startsWith(root + path.sep))) throw new Error('Plugin entry escapes plugin root');
  const source = fs.readFileSync(entryPath, 'utf8');
  if (source.length > 1024 * 1024) throw new Error('Plugin entry exceeds 1 MiB limit');

  const register = (definition) => {
    if (registration) throw new Error('Plugin may register only once');
    if (!definition || typeof definition !== 'object') throw new Error('Plugin registration must be an object');
    registration = {
      onActivate: typeof definition.onActivate === 'function' ? definition.onActivate : null,
      onDeactivate: typeof definition.onDeactivate === 'function' ? definition.onDeactivate : null,
      slots: definition.slots && typeof definition.slots === 'object' ? definition.slots : {},
    };
  };

  const sandbox = Object.create(null);
  Object.assign(sandbox, {
    register,
    nexus: createApi(),
    console: Object.freeze({
      log: (...args) => audit('PLUGIN_LOG', { level: 'log', message: args.map(String).join(' ').slice(0, 2000) }),
      warn: (...args) => audit('PLUGIN_LOG', { level: 'warn', message: args.map(String).join(' ').slice(0, 2000) }),
      error: (...args) => audit('PLUGIN_LOG', { level: 'error', message: args.map(String).join(' ').slice(0, 2000) }),
    }),
    setTimeout,
    clearTimeout,
  });
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox, {
    name: `nexus-plugin:${manifest.id}`,
    codeGeneration: { strings: false, wasm: false },
  });
  const script = new vm.Script(`"use strict";\n${source}`, { filename: entryPath });
  script.runInContext(context, { timeout: startupTimeoutMs });
  if (!registration) throw new Error('Plugin did not call register(...)');
  for (const slotName of Object.keys(registration.slots)) {
    if (!(manifest.slots || []).includes(slotName)) throw new Error(`Plugin registered undeclared slot: ${slotName}`);
    if (typeof registration.slots[slotName] !== 'function') throw new Error(`Slot handler must be a function: ${slotName}`);
  }
}

async function runCommand(command, payload) {
  if (!registration) throw new Error('Plugin is not loaded');
  if (command === 'activate') {
    if (!active && registration.onActivate) await registration.onActivate();
    active = true;
    return true;
  }
  if (command === 'deactivate') {
    if (active && registration.onDeactivate) await registration.onDeactivate();
    active = false;
    return true;
  }
  if (command === 'invokeSlot') {
    if (!active) throw new Error(`Plugin is not active: ${manifest.id}`);
    const handler = registration.slots[payload.slotName];
    if (typeof handler !== 'function') throw new Error(`Plugin does not implement slot: ${payload.slotName}`);
    return cloneJson(await handler(cloneJson(payload.payload)));
  }
  throw new Error(`Unknown plugin command: ${command}`);
}

parentPort.on('message', (message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'capabilityResult') {
    const pending = capabilityPending.get(message.requestId);
    if (!pending) return;
    capabilityPending.delete(message.requestId);
    if (message.ok) pending.resolve(cloneJson(message.value));
    else pending.reject(new Error(message.value || 'Capability call failed'));
    return;
  }
  if (message.type === 'command') {
    parentPort.postMessage({ type: 'commandStarted', requestId: message.requestId });
    Promise.resolve()
      .then(() => runCommand(message.command, message.payload || {}))
      .then((value) => parentPort.postMessage({ type: 'result', requestId: message.requestId, ok: true, value: cloneJson(value) }))
      .catch((error) => parentPort.postMessage({ type: 'result', requestId: message.requestId, ok: false, error: error?.message || String(error) }));
  }
});

try {
  loadPlugin();
  parentPort.postMessage({ type: 'ready' });
} catch (error) {
  parentPort.postMessage({ type: 'loadError', error: error?.message || String(error) });
}
