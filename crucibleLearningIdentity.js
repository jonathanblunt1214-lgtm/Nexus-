const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ISSUER = 'nexus://trusted-plugin-host';
const AUDIENCE = 'the-crucible-learning';

function canonicalWorkspace(projectRoot) {
  const resolved = fs.realpathSync(path.resolve(projectRoot));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

class CrucibleLearningIdentity {
  constructor(projectRoot, material = null) {
    this.workspace = canonicalWorkspace(projectRoot);
    this.fingerprint = crypto.createHash('sha256').update(this.workspace).digest('hex');
    this.projectId = `nexus-workspace-${this.fingerprint.slice(0, 32)}`;
    this.repository = `workspace:${this.fingerprint}`;
    this.ref = 'nexus:opened-workspace';
    this.subject = `nexus-workspace:${this.fingerprint}`;
    this.masterKey = material?.masterKey || crypto.randomBytes(32).toString('base64url');
    const pair = material?.privateKeyPem
      ? { privateKey: crypto.createPrivateKey(material.privateKeyPem), publicKey: crypto.createPublicKey(material.privateKeyPem) }
      : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = pair.privateKey;
    this.publicJwk = pair.publicKey.export({ format: 'jwk' });
    this.publicJwk.kid = `nexus-${this.fingerprint.slice(0, 16)}`;
    this.publicJwk.alg = 'RS256';
  }

  token(now = Date.now()) {
    const seconds = Math.floor(now / 1000);
    const header = b64urlJson({ alg: 'RS256', kid: this.publicJwk.kid });
    const claims = b64urlJson({
      iss: ISSUER,
      aud: AUDIENCE,
      repository: this.repository,
      ref: this.ref,
      project_id: this.projectId,
      sub: this.subject,
      iat: seconds - 5,
      exp: seconds + 300,
    });
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), this.privateKey).toString('base64url');
    return `${header}.${claims}.${signature}`;
  }

  identity(now = Date.now()) {
    const { kty, kid, alg, n, e } = this.publicJwk;
    return {
      jwks: { keys: [{ kty, kid, alg, n, e }] },
      issuer: ISSUER,
      audience: AUDIENCE,
      repository: this.repository,
      ref: this.ref,
      projectId: this.projectId,
      now,
    };
  }

  decorate(pluginId, slotName, payload = {}) {
    if (pluginId !== 'the-crucible' || slotName !== 'project-actions') return payload;
    const next = { ...payload, projectId: this.projectId };
    if (next.candidate && typeof next.candidate === 'object') next.candidate = { ...next.candidate, projectId: this.projectId };
    const transport = ['crucible-learning-configure', 'crucible-learning-oidc-verify', 'crucible-learning-weekly-encrypt', 'crucible-learning-weekly-decrypt'];
    if (transport.includes(next.actionId)) {
      next.oidcToken = this.token();
      next.oidcSubject = this.subject;
    }
    if (next.actionId === 'crucible-learning-configure') {
      next.identity = this.identity();
      next.masterKey = this.masterKey;
      next.configuredAt = new Date().toISOString();
    } else if (next.actionId === 'crucible-learning-weekly-encrypt' || next.actionId === 'crucible-learning-weekly-decrypt') {
      next.masterKey = this.masterKey;
    }
    return next;
  }

  publicStatus() {
    return { projectId: this.projectId, issuer: ISSUER, audience: AUDIENCE, repository: this.repository, ref: this.ref, oidcSubject: this.subject };
  }

  exportMaterial() {
    return { masterKey: this.masterKey, privateKeyPem: this.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  }
}

module.exports = { CrucibleLearningIdentity, canonicalWorkspace, ISSUER, AUDIENCE };
