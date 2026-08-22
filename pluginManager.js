const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validatePluginManifest } = require('./pluginManifest');
const { PluginRuntime } = require('./pluginRuntime');
const { writeJsonAtomicSync } = require('./atomicWrite');

function stableManifestPayload(manifest) {
  const copy = { ...manifest };
  delete copy.signature;
  return Buffer.from(JSON.stringify(copy, Object.keys(copy).sort()), 'utf8');
}

function verifyManifestSignature(manifest, trustedPublicKeys = []) {
  if (!manifest.signature) return false;
  const signature = Buffer.from(String(manifest.signature), 'base64');
  return trustedPublicKeys.some((key) => {
    try { return crypto.verify(null, stableManifestPayload(manifest), key, signature); } catch { return false; }
  });
}

class PluginAuditLedger {
  constructor({ projectRoot }) {
    this.file = path.join(projectRoot, '.nexus', 'plugin-audit.jsonl');
    this.previousHash = null;
  }

  record(pluginId, eventCode, metadata = {}) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const event = {
      timestamp: new Date().toISOString(),
      pluginId,
      eventCode,
      metadata,
      previousHash: this.previousHash,
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
    fs.appendFileSync(this.file, `${JSON.stringify({ ...event, hash })}\n`, 'utf8');
    this.previousHash = hash;
    return { ...event, hash };
  }
}

class PluginManager {
  constructor({
    projectRoot,
    nexusVersion = '1.1.0',
    capabilityHandlers = {},
    trustedPublicKeys = [],
    requireSigned = true,
    allowUnsignedDevelopment = false,
    runtime,
  }) {
    if (!projectRoot) throw new Error('projectRoot is required');
    this.projectRoot = path.resolve(projectRoot);
    this.pluginsRoot = path.join(this.projectRoot, '.nexus', 'plugins');
    this.stateFile = path.join(this.projectRoot, '.nexus', 'plugins-state.json');
    this.nexusVersion = nexusVersion;
    this.trustedPublicKeys = trustedPublicKeys;
    this.requireSigned = requireSigned;
    this.allowUnsignedDevelopment = allowUnsignedDevelopment;
    this.runtime = runtime || new PluginRuntime({ capabilityHandlers });
    this.ledger = new PluginAuditLedger({ projectRoot: this.projectRoot });
    this.registry = new Map();
    this.slots = new Map();
  }

  audit(pluginId, eventCode, metadata) {
    return this.ledger.record(pluginId, eventCode, metadata);
  }

  loadState() {
    try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch { return { disabled: [] }; }
  }

  saveState(state) {
    writeJsonAtomicSync(this.stateFile, state);
  }

  discover() {
    fs.mkdirSync(this.pluginsRoot, { recursive: true });
    const disabled = new Set(this.loadState().disabled || []);
    const discovered = [];
    for (const entry of fs.readdirSync(this.pluginsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const pluginRoot = path.join(this.pluginsRoot, entry.name);
      const manifestPath = path.join(pluginRoot, 'nexus.plugin.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const manifest = validatePluginManifest(raw, { nexusVersion: this.nexusVersion });
        const signed = verifyManifestSignature(raw, this.trustedPublicKeys);
        if (this.requireSigned && !signed && !this.allowUnsignedDevelopment) throw new Error('Plugin signature is required and was not trusted');
        const record = {
          id: manifest.id,
          manifest,
          pluginRoot,
          signed,
          status: disabled.has(manifest.id) ? 'DISABLED' : 'DISCOVERED',
          error: null,
        };
        this.registry.set(manifest.id, record);
        discovered.push(this.publicRecord(record));
        this.audit(manifest.id, 'PLUGIN_DISCOVERED', { signed, status: record.status });
      } catch (error) {
        this.audit(entry.name, 'PLUGIN_REJECTED', { error: error.message });
        discovered.push({ id: entry.name, status: 'REJECTED', error: error.message });
      }
    }
    return discovered;
  }

  publicRecord(record) {
    return {
      id: record.id,
      name: record.manifest?.name || record.id,
      version: record.manifest?.version || null,
      status: record.status,
      signed: !!record.signed,
      capabilities: record.manifest?.capabilities || [],
      slots: record.manifest?.slots || [],
      health: record.status === 'ACTIVE' ? this.runtime.health(record.id) : null,
      error: record.error || null,
    };
  }

  list() {
    return [...this.registry.values()].map((record) => this.publicRecord(record));
  }

  async enable(pluginId) {
    const record = this.registry.get(pluginId);
    if (!record) throw new Error(`Unknown plugin: ${pluginId}`);
    if (record.status === 'ACTIVE') return this.publicRecord(record);
    try {
      if (!this.runtime.instances.has(pluginId)) {
        this.runtime.load({ manifest: record.manifest, pluginRoot: record.pluginRoot, audit: (code, metadata) => this.audit(pluginId, code, metadata) });
      }
      await this.runtime.activate(pluginId, (code, metadata) => this.audit(pluginId, code, metadata));
      record.status = 'ACTIVE';
      record.error = null;
      for (const slot of record.manifest.slots) {
        if (!this.slots.has(slot)) this.slots.set(slot, new Set());
        this.slots.get(slot).add(pluginId);
      }
      const state = this.loadState();
      state.disabled = (state.disabled || []).filter((id) => id !== pluginId);
      this.saveState(state);
      return this.publicRecord(record);
    } catch (error) {
      record.status = 'ERROR';
      record.error = error.message;
      this.audit(pluginId, 'PLUGIN_ERROR', { phase: 'enable', error: error.message });
      throw error;
    }
  }

  async disable(pluginId) {
    const record = this.registry.get(pluginId);
    if (!record) throw new Error(`Unknown plugin: ${pluginId}`);
    await this.runtime.deactivate(pluginId, (code, metadata) => this.audit(pluginId, code, metadata));
    this.runtime.unload(pluginId);
    for (const ids of this.slots.values()) ids.delete(pluginId);
    record.status = 'DISABLED';
    const state = this.loadState();
    state.disabled = [...new Set([...(state.disabled || []), pluginId])];
    this.saveState(state);
    this.audit(pluginId, 'PLUGIN_DISABLED', {});
    return this.publicRecord(record);
  }

  listSlots() {
    return [...this.slots.entries()].map(([slot, ids]) => ({ slot, pluginIds: [...ids] }));
  }

  async invokeSlot(slot, payload = {}) {
    const ids = [...(this.slots.get(slot) || [])];
    const results = [];
    for (const pluginId of ids) {
      try {
        const value = await this.runtime.invokeSlot(pluginId, slot, payload, (code, metadata) => this.audit(pluginId, code, metadata));
        results.push({ pluginId, ok: true, value });
      } catch (error) {
        const record = this.registry.get(pluginId);
        if (record) { record.status = 'ERROR'; record.error = error.message; }
        this.audit(pluginId, 'PLUGIN_ERROR', { phase: 'slot', slot, error: error.message });
        results.push({ pluginId, ok: false, error: error.message });
      }
    }
    return results;
  }

  health() {
    return this.list().map((record) => ({ id: record.id, status: record.status, runtime: this.runtime.health(record.id) }));
  }
}

module.exports = { PluginManager, PluginAuditLedger, stableManifestPayload, verifyManifestSignature };
