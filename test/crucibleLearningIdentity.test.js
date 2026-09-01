const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CrucibleLearningIdentity } = require('../crucibleLearningIdentity');

function decode(value) { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }

test('trusted OIDC identity binds tokens and project IDs to the real workspace path', () => {
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-crucible-identity-a-'));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-crucible-identity-b-'));
  const first = new CrucibleLearningIdentity(firstRoot);
  const same = new CrucibleLearningIdentity(firstRoot, first.exportMaterial());
  const second = new CrucibleLearningIdentity(secondRoot);
  assert.equal(first.projectId, same.projectId);
  assert.notEqual(first.projectId, second.projectId);
  assert.match(first.projectId, /^nexus-workspace-[a-f0-9]{32}$/);
  const token = first.token(); const [header, body, signature] = token.split('.'); const claims = decode(body);
  assert.equal(claims.project_id, first.projectId);
  assert.equal(claims.repository, first.repository);
  assert.equal(claims.ref, 'nexus:opened-workspace');
  assert.equal(claims.sub, first.subject);
  assert.ok(claims.exp - claims.iat <= 310);
  const publicKey = crypto.createPublicKey({ key: first.identity().jwks.keys[0], format: 'jwk' });
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${body}`), publicKey, Buffer.from(signature, 'base64url')), true);
  assert.equal(Buffer.from(first.masterKey, 'base64url').length, 32);
});

test('host decoration supplies secrets only to secure Crucible actions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-crucible-decorate-'));
  const identity = new CrucibleLearningIdentity(root);
  assert.deepEqual(identity.decorate('another-plugin', 'project-actions', { actionId: 'x' }), { actionId: 'x' });
  const readiness = identity.decorate('the-crucible', 'project-actions', { actionId: 'crucible-learning-readiness' });
  assert.equal(readiness.projectId, identity.projectId);
  assert.equal(readiness.masterKey, undefined);
  assert.equal(readiness.oidcToken, undefined);
  const configure = identity.decorate('the-crucible', 'project-actions', { actionId: 'crucible-learning-configure' });
  assert.equal(configure.projectId, identity.projectId);
  assert.equal(configure.masterKey, identity.masterKey);
  assert.equal(configure.identity.projectId, identity.projectId);
  assert.equal(decode(configure.oidcToken.split('.')[1]).sub, identity.subject);
});

test('the active project plugin refresh provisions secure Crucible readiness through narrow IPC', () => {
  const root = path.resolve(__dirname, '..');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  assert.match(preload, /pluginsCrucibleProvision:[\s\S]*plugins:crucible-provision/);
  assert.match(renderer, /refreshPluginSecurityList[\s\S]*pluginsCrucibleProvision\(folder\)[\s\S]*readiness\?\.ready/);
});
