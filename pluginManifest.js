const path = require('path');

const SUPPORTED_API_VERSION = 1;
const ALLOWED_CAPABILITIES = new Set([
  'workspace:read',
  'workspace:write',
  'git:read',
  'git:write',
  'network:request',
  'ui:slot',
  'telemetry:emit',
  'account:private',
]);
const ALLOWED_SLOTS = new Set([
  'sidebar',
  'project-actions',
  'inspector-panel',
  'status-panel',
  'command-palette',
]);

function parseVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function compareVersions(a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  if (!av || !bv) throw new Error('Versions must use semantic version format x.y.z');
  for (let i = 0; i < 3; i += 1) {
    if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1;
  }
  return 0;
}

function isSafeRelativeEntry(entry) {
  if (typeof entry !== 'string' || !entry.trim() || path.isAbsolute(entry)) return false;
  const normalized = path.normalize(entry);
  return normalized !== '..' && !normalized.startsWith(`..${path.sep}`) && !normalized.includes(`..${path.sep}`);
}

function validatePluginManifest(manifest, { nexusVersion = '1.1.0' } = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Plugin manifest must be an object');
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(manifest.id || '')) throw new Error('Plugin id is invalid');
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) throw new Error('Plugin name is required');
  if (!parseVersion(manifest.version)) throw new Error('Plugin version must use semantic version format x.y.z');
  if (manifest.apiVersion !== SUPPORTED_API_VERSION) throw new Error(`Unsupported plugin apiVersion: ${manifest.apiVersion}`);
  if (!isSafeRelativeEntry(manifest.entry)) throw new Error('Plugin entry must be a safe relative path');
  if (manifest.minNexusVersion && compareVersions(nexusVersion, manifest.minNexusVersion) < 0) {
    throw new Error(`Plugin requires Nexus >= ${manifest.minNexusVersion}`);
  }

  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  for (const capability of capabilities) {
    if (!ALLOWED_CAPABILITIES.has(capability)) throw new Error(`Unsupported plugin capability: ${capability}`);
  }

  const slots = Array.isArray(manifest.slots) ? manifest.slots : [];
  for (const slot of slots) {
    if (!ALLOWED_SLOTS.has(slot)) throw new Error(`Unsupported plugin slot: ${slot}`);
  }

  return Object.freeze({
    id: manifest.id,
    name: manifest.name.trim(),
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    entry: path.normalize(manifest.entry),
    minNexusVersion: manifest.minNexusVersion || null,
    capabilities: Object.freeze([...new Set(capabilities)]),
    slots: Object.freeze([...new Set(slots)]),
    description: typeof manifest.description === 'string' ? manifest.description.slice(0, 1000) : '',
    signature: manifest.signature || null,
  });
}

module.exports = {
  SUPPORTED_API_VERSION,
  ALLOWED_CAPABILITIES,
  ALLOWED_SLOTS,
  parseVersion,
  compareVersions,
  isSafeRelativeEntry,
  validatePluginManifest,
};
