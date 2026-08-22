const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePluginManifest, compareVersions } = require('../pluginManifest');

function manifest(overrides = {}) {
  return { id:'demo.plugin', name:'Demo', version:'1.0.0', apiVersion:1, entry:'index.js', capabilities:['ui:slot'], slots:['sidebar'], ...overrides };
}

test('validates safe compatible manifests', () => {
  const value = validatePluginManifest(manifest(), { nexusVersion:'1.1.0' });
  assert.equal(value.id, 'demo.plugin');
  assert.deepEqual(value.slots, ['sidebar']);
});

test('rejects traversal, unknown capabilities, and incompatible versions', () => {
  assert.throws(() => validatePluginManifest(manifest({ entry:'../escape.js' })), /safe relative path/);
  assert.throws(() => validatePluginManifest(manifest({ capabilities:['process:raw'] })), /Unsupported plugin capability/);
  assert.throws(() => validatePluginManifest(manifest({ minNexusVersion:'9.0.0' }), { nexusVersion:'1.1.0' }), /requires Nexus/);
});

test('semantic version comparison is deterministic', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('1.1.0', '1.1.0'), 0);
});
