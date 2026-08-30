const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validatePluginManifest } = require('./pluginManifest');
const { PluginRuntime } = require('./pluginRuntime');
const { writeJsonAtomicSync } = require('./atomicWrite');
const { screenPlugin, hashPluginDirectory } = require('./pluginSecurityScanner');
const { enumeratePluginFiles } = require('./pluginSecurityScanner');

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
    slotPayloadDecorator = null,
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
    this.slotPayloadDecorator = slotPayloadDecorator;
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
        const screened = this.loadState().screened?.[manifest.id] === hashPluginDirectory(pluginRoot);
        if (this.requireSigned && !signed && !screened && !this.allowUnsignedDevelopment) throw new Error('Plugin signature is required unless a current Nexus malware screening approval exists');
        const record = {
          id: manifest.id,
          manifest,
          pluginRoot,
          signed,
          screened,
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
      screened: !!record.screened,
      capabilities: record.manifest?.capabilities || [],
      slots: record.manifest?.slots || [],
      health: record.status === 'ACTIVE' ? this.runtime.health(record.id) : null,
      error: record.error || null,
    };
  }

  list() {
    return [...this.registry.values()].map((record) => this.publicRecord(record));
  }

  async importFromFolder(sourceFolder, options = {}) {
    const source = fs.realpathSync(path.resolve(sourceFolder));
    if (source === this.pluginsRoot || source.startsWith(`${this.pluginsRoot}${path.sep}`)) throw new Error('Choose a plug-in folder outside the installed plug-ins directory.');
    const manifestPath = path.join(source, 'nexus.plugin.json');
    if (!fs.existsSync(manifestPath)) throw new Error('The selected folder has no nexus.plugin.json manifest.');
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const manifest = validatePluginManifest(raw, { nexusVersion: this.nexusVersion });
    if (!fs.existsSync(path.join(source, manifest.entry))) throw new Error('The plug-in entry file is missing.');
    const report = await screenPlugin(source, options);
    if (!report.passed) {
      this.audit(manifest.id, 'PLUGIN_UPLOAD_BLOCKED', { score: report.behavior.score, findings: report.behavior.findings.map((item) => ({ rule: item.rule, severity: item.severity, file: item.file })) });
      return { ok: false, blocked: true, pluginId: manifest.id, report };
    }
    fs.mkdirSync(this.pluginsRoot, { recursive: true });
    const destination = path.join(this.pluginsRoot, manifest.id);
    if (fs.existsSync(destination)) throw new Error('A plug-in with this ID is already installed. Remove it before importing a replacement.');
    const staging = path.join(this.pluginsRoot, `.screened-${crypto.randomUUID()}`);
    try { fs.cpSync(source, staging, { recursive: true, errorOnExist: true }); fs.renameSync(staging, destination); } catch (error) { fs.rmSync(staging, { recursive: true, force: true }); throw error; }
    const digest = hashPluginDirectory(destination);
    const state = this.loadState();
    state.screened = { ...(state.screened || {}), [manifest.id]: digest };
    state.disabled = [...new Set([...(state.disabled || []), manifest.id])];
    this.saveState(state);
    this.audit(manifest.id, 'PLUGIN_UPLOADED_AFTER_SCREENING', { digest, score: report.behavior.score, defender: report.defender.engine });
    this.discover();
    return { ok: true, plugin: this.registry.get(manifest.id) ? this.publicRecord(this.registry.get(manifest.id)) : null, report };
  }

  installBundledFromFolder(sourceFolder) {
    const source = fs.realpathSync(path.resolve(sourceFolder));
    const raw = JSON.parse(fs.readFileSync(path.join(source, 'nexus.plugin.json'), 'utf8'));
    const manifest = validatePluginManifest(raw, { nexusVersion: this.nexusVersion });
    if (manifest.id !== 'the-crucible') throw new Error('Bundled provisioning is restricted to The Crucible plugin.');
    if (!fs.existsSync(path.join(source, manifest.entry))) throw new Error('The bundled Crucible entry file is missing.');
    fs.mkdirSync(this.pluginsRoot, { recursive: true });
    const destination = path.join(this.pluginsRoot, manifest.id);
    const staging = path.join(this.pluginsRoot, `.bundled-${crypto.randomUUID()}`);
    const backup = path.join(this.pluginsRoot, `.previous-${crypto.randomUUID()}`);
    try {
      fs.cpSync(source, staging, { recursive: true, errorOnExist: true });
      if (fs.existsSync(destination)) fs.renameSync(destination, backup);
      fs.renameSync(staging, destination);
      fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      if (!fs.existsSync(destination) && fs.existsSync(backup)) fs.renameSync(backup, destination);
      throw error;
    }
    const digest = hashPluginDirectory(destination);
    const state = this.loadState();
    state.screened = { ...(state.screened || {}), [manifest.id]: digest };
    state.disabled = [...new Set([...(state.disabled || []), manifest.id])];
    this.saveState(state);
    this.audit(manifest.id, 'PLUGIN_BUNDLED_INSTALLED', { version: manifest.version, digest });
    this.discover();
    return this.publicRecord(this.registry.get(manifest.id));
  }

  createMarketplacePackage(pluginId) {
    this.discover();
    const record = this.registry.get(pluginId);
    if (!record || !record.screened) throw new Error('A plug-in must pass the current Nexus security screening before it can be published.');
    const inventory = enumeratePluginFiles(record.pluginRoot);
    const payload = { format:'nexus-plugin-package', version:1, pluginId, digest:hashPluginDirectory(record.pluginRoot), files:inventory.files.map((file) => ({ path:file.relative.replace(/\\/g, '/'), data:fs.readFileSync(file.full).toString('base64') })) };
    const content = JSON.stringify(payload);
    return { content, digest:payload.digest, packageDigest:crypto.createHash('sha256').update(content).digest('hex'), manifest:record.manifest, signed:record.signed, screened:record.screened };
  }

  async importMarketplacePackage(serialized, options = {}) {
    let payload;
    try { payload = JSON.parse(serialized); } catch { throw new Error('Marketplace package is not valid JSON.'); }
    if (payload?.format !== 'nexus-plugin-package' || payload.version !== 1 || !Array.isArray(payload.files) || payload.files.length > 250) throw new Error('Marketplace package format is invalid.');
    const staging = path.join(this.projectRoot, '.nexus', `.marketplace-${crypto.randomUUID()}`);
    fs.mkdirSync(staging, { recursive:true });
    let total = 0;
    try {
      for (const item of payload.files) {
        if (typeof item.path !== 'string' || path.isAbsolute(item.path)) throw new Error('Marketplace package contains an unsafe path.');
        const destination = path.resolve(staging, item.path); if (!destination.startsWith(`${staging}${path.sep}`)) throw new Error('Marketplace package path escapes staging.');
        const data = Buffer.from(String(item.data || ''), 'base64'); total += data.length; if (total > 15 * 1024 * 1024) throw new Error('Marketplace package exceeds 15 MB.');
        fs.mkdirSync(path.dirname(destination), { recursive:true }); fs.writeFileSync(destination, data);
      }
      if (hashPluginDirectory(staging) !== payload.digest) throw new Error('Marketplace package contents failed digest verification.');
      return await this.importFromFolder(staging, options);
    } finally { fs.rmSync(staging, { recursive:true, force:true }); }
  }

  async enable(pluginId) {
    const record = this.registry.get(pluginId);
    if (!record) throw new Error(`Unknown plugin: ${pluginId}`);
    if (record.status === 'ACTIVE') return this.publicRecord(record);
    try {
      if (!this.runtime.instances.has(pluginId)) {
        await this.runtime.load({ manifest: record.manifest, pluginRoot: record.pluginRoot, audit: (code, metadata) => this.audit(pluginId, code, metadata) });
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
        const decorated = this.slotPayloadDecorator ? await this.slotPayloadDecorator(pluginId, slot, payload) : payload;
        const value = await this.runtime.invokeSlot(pluginId, slot, decorated, (code, metadata) => this.audit(pluginId, code, metadata));
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
