const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const publisherConfig = require('./publisherConfig');
const firebaseAccountClient = require('./firebaseAccountClient');

function decryptConfigValue(cfg, key, safeStorage) {
  const encrypted = cfg[`${key}Enc`];
  if (encrypted && safeStorage?.isEncryptionAvailable?.()) {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }
  return cfg[key] || null;
}

function accountConfiguration(cfg = {}) {
  return {
    apiKey: process.env.NEXUS_FIREBASE_WEB_API_KEY || cfg.firebaseWebApiKey || publisherConfig.firebaseWebApiKey,
    projectId: process.env.NEXUS_FIREBASE_PROJECT_ID || cfg.firebaseProjectId || publisherConfig.firebaseProjectId,
  };
}

function trackingDocumentUrl(projectId, uid) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/nexusCruciblePluginTracking/${encodeURIComponent(uid)}`;
}

async function responseJson(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${data?.error?.message || 'request rejected'}`);
  return data;
}

function projectFingerprint(projectRoot) {
  return crypto.createHash('sha256').update(path.resolve(projectRoot)).digest('hex');
}

function normalizeTrackingState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { schemaVersion: 1, injections: [] };
  return {
    schemaVersion: 1,
    injections: Array.isArray(value.injections) ? value.injections.slice(-500) : [],
  };
}

function createCruciblePluginAccountApi({ app, safeStorage }) {
  if (!app || !safeStorage) throw new Error('app and safeStorage are required');
  const configPath = path.join(app.getPath('userData'), 'nexus-config.json');

  async function session() {
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch { throw new Error('Sign in to the Nexus account before using private Crucible tracking.'); }
    const configuration = accountConfiguration(cfg);
    firebaseAccountClient.requireConfiguration(configuration.apiKey, configuration.projectId);
    const uid = cfg.firebaseUid;
    const refreshToken = decryptConfigValue(cfg, 'firebaseRefreshToken', safeStorage);
    if (!uid || !refreshToken) throw new Error('Sign in to the Nexus account before using private Crucible tracking.');
    const refreshed = await firebaseAccountClient.refreshSession(configuration.apiKey, refreshToken);
    if (refreshed.uid && refreshed.uid !== uid) throw new Error('Nexus account session identity changed; sign in again.');
    return { uid, idToken: refreshed.idToken, configuration };
  }

  async function loadState(auth) {
    const response = await fetch(trackingDocumentUrl(auth.configuration.projectId, auth.uid), {
      headers: { Authorization: `Bearer ${auth.idToken}` },
    });
    if (response.status === 404) return normalizeTrackingState(null);
    const data = await responseJson(response, 'Crucible account tracking read');
    const serialized = data.fields?.state?.stringValue;
    if (!serialized) return normalizeTrackingState(null);
    try { return normalizeTrackingState(JSON.parse(serialized)); }
    catch { return normalizeTrackingState(null); }
  }

  async function saveState(auth, state) {
    const normalized = normalizeTrackingState(state);
    const response = await fetch(trackingDocumentUrl(auth.configuration.projectId, auth.uid), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.idToken}` },
      body: JSON.stringify({ fields: {
        state: { stringValue: JSON.stringify(normalized) },
        updatedAt: { timestampValue: new Date().toISOString() },
        schemaVersion: { integerValue: '1' },
      } }),
    });
    await responseJson(response, 'Crucible account tracking write');
  }

  return async function accountPrivate(payload = {}, context = {}) {
    if (context.pluginId !== 'the-crucible') throw new Error('Private Crucible account tracking is restricted to The Crucible plugin.');
    const auth = await session();
    const operation = String(payload.operation || 'list');
    const state = await loadState(auth);

    if (operation === 'status') return { ok: true, signedIn: true, accountScoped: true, count: state.injections.length };
    if (operation === 'list') {
      const fingerprint = payload.projectRoot ? projectFingerprint(payload.projectRoot) : null;
      const injections = fingerprint ? state.injections.filter((item) => item.projectFingerprint === fingerprint) : state.injections;
      return { ok: true, accountScoped: true, injections: injections.slice().reverse() };
    }
    if (operation === 'record') {
      if (!payload.projectRoot) throw new Error('projectRoot is required for injection tracking.');
      const files = Array.isArray(payload.files) ? payload.files.map((item) => String(item.path || item)).filter(Boolean).slice(0, 128) : [];
      const record = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        projectFingerprint: projectFingerprint(payload.projectRoot),
        pluginVersion: String(payload.pluginVersion || ''),
        action: String(payload.action || 'inject').slice(0, 80),
        files,
      };
      state.injections.push(record);
      state.injections = state.injections.slice(-500);
      await saveState(auth, state);
      return { ok: true, accountScoped: true, record };
    }
    throw new Error(`Unsupported private account operation: ${operation}`);
  };
}

module.exports = { createCruciblePluginAccountApi, projectFingerprint, normalizeTrackingState, trackingDocumentUrl };
