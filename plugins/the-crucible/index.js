'use strict';

const PLUGIN_ID = 'the-crucible';
const PLUGIN_NAME = 'The Crucible';
const VERSION = '0.3.0';
const GOVERNANCE_ROOT = 'governingDocuments';
const REFERENCE_MANIFEST = `${GOVERNANCE_ROOT}/CRUCIBLE-REFERENCES.json`;
const BRANCH_LINK_MANIFEST = `${GOVERNANCE_ROOT}/BRANCH-LINKS.json`;
const CANONICAL_REPOSITORY = 'jonathanblunt1214-lgtm/The-Crucible';
const CANONICAL_BRANCH = 'main';
const LEARNING_ROOT = `${GOVERNANCE_ROOT}/.crucible-learning`;
const LEARNING_STATES = Object.freeze(['candidate', 'hypothesis', 'experimented', 'causally-proven', 'independently-verified', 'verified', 'quarantined', 'rejected']);
const REQUIRED_LEARNING_GATES = Object.freeze(['falsifiableHypothesis', 'controlledReproduction', 'causalIsolation', 'controlTesting', 'independentVerification', 'negativeTesting', 'regressionTesting', 'deterministicScopeProof', 'claimBoundaryCheck', 'generalizationCheck', 'contradictionAnalysis']);
const PROHIBITED_PROMOTION_KINDS = Object.freeze(['raw-telemetry', 'correlation', 'one-off-repair', 'repeated-observation', 'model-guess', 'incomplete-observation', 'untested-hypothesis', 'retrieval']);
const CANDIDATE_KEYS = Object.freeze(['schemaVersion', 'id', 'projectId', 'claim', 'claimBoundary', 'generalizationBoundary', 'kind', 'provenance', 'createdAt']);
const PROVENANCE_KEYS = Object.freeze(['sourceType', 'sourceId', 'retrievedAt', 'author', 'license', 'contentSha256']);

const CANONICAL_DOCUMENTS = Object.freeze([
  'AGENTS.md',
  'README.md',
  'templates/ai-conflict-resolution.md',
  'templates/required-check-rollout.md',
  'templates/agent-boundaries.md',
  'governingDocuments/branch-linking-policy.md',
  'governingDocuments/scientific-learning-policy.md',
  'governingDocuments/BRANCH-LINKS.json',
  'governingDocuments/templates/injection-prerequisites.md',
  'governingDocuments/templates/injection-monitoring.md',
  'governingDocuments/templates/injection-monitor-task.md',
  'governingDocuments/templates/injection-native-validation.md',
  'governingDocuments/templates/injection-credential-scope.md',
  'governingDocuments/templates/INJECTION-PREREQUISITES.example.json'
]);

function canonicalUrl(path) {
  return `https://github.com/${CANONICAL_REPOSITORY}/blob/${CANONICAL_BRANCH}/${path}`;
}

function canonicalReferenceManifest() {
  return {
    schemaVersion: 1,
    source: {
      repository: CANONICAL_REPOSITORY,
      branch: CANONICAL_BRANCH,
      policy: 'reference-shared-content-from-default-branch'
    },
    documents: CANONICAL_DOCUMENTS.map((path) => ({ path, url: canonicalUrl(path) })),
    localOverlayRoot: GOVERNANCE_ROOT,
    branchLinkManifest: BRANCH_LINK_MANIFEST,
    note: 'Shared Crucible governance is referenced from the default branch. Branch relationships are project data, not inferred from example names.'
  };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function requireObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`); }
function requireExactKeys(value, allowed, label) {
  requireObject(value, label);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${label} contains unknown field(s): ${extras.join(', ')}.`);
}
function requireText(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`); return value.trim(); }
function requireIso(value, label) { requireText(value, label); if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`); }
function requireDigest(value, label) { if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error(`${label} must be a lowercase SHA-256 digest.`); }
function requireProjectId(value) { const id = requireText(value, 'projectId'); if (!/^[A-Za-z0-9._-]{1,100}$/.test(id)) throw new Error('projectId must use only letters, digits, dot, underscore, or hyphen.'); return id; }
function requireTextArray(value, label) { if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`${label} must be a non-empty text array.`); }
function learningPath(projectId, name) { return `${LEARNING_ROOT}/${requireProjectId(projectId)}/${name}.json`; }

function validateLearningConfiguration(value, projectId) {
  const keys = ['schemaVersion', 'status', 'projectId', 'issuer', 'audience', 'repository', 'ref', 'oidcSubject', 'jwks', 'masterKeySha256', 'configuredAt'];
  requireExactKeys(value, keys, 'learning configuration');
  if (value.schemaVersion !== 1 || value.status !== 'ready' || value.projectId !== requireProjectId(projectId)) throw new Error('Learning configuration identity, status, or schema is invalid.');
  for (const key of ['issuer', 'audience', 'repository', 'ref', 'oidcSubject']) requireText(value[key], `learning configuration.${key}`);
  requireExactKeys(value.jwks, ['keys'], 'learning configuration.jwks');
  if (!Array.isArray(value.jwks.keys) || !value.jwks.keys.length) throw new Error('learning configuration.jwks.keys must be a non-empty array.');
  for (const key of value.jwks.keys) {
    requireExactKeys(key, ['kty', 'kid', 'alg', 'n', 'e'], 'learning configuration JWK');
    if (key.kty !== 'RSA' || key.alg !== 'RS256') throw new Error('Learning configuration accepts only trusted RS256 RSA keys.');
    for (const field of ['kid', 'n', 'e']) requireText(key[field], `learning configuration JWK.${field}`);
  }
  requireDigest(value.masterKeySha256, 'learning configuration.masterKeySha256');
  requireIso(value.configuredAt, 'learning configuration.configuredAt');
  return clone(value);
}

async function readLearningConfiguration(projectId, required = true) {
  const id = requireProjectId(projectId);
  try { return validateLearningConfiguration(JSON.parse(await readWorkspaceText(learningPath(id, 'configuration'))), id); }
  catch (error) {
    if (!required && /not found/i.test(String(error?.message || ''))) return null;
    if (/not found/i.test(String(error?.message || ''))) throw new Error('Scientific learning is not ready. Configure the project ID, trusted OIDC identity, and ephemeral transport key before supplying training evidence.');
    throw error;
  }
}

function validateLearningCandidate(value) {
  requireExactKeys(value, CANDIDATE_KEYS, 'candidate');
  if (value.schemaVersion !== 1) throw new Error('candidate.schemaVersion must be 1.');
  for (const key of ['id', 'projectId', 'claim', 'claimBoundary', 'generalizationBoundary', 'kind']) requireText(value[key], `candidate.${key}`);
  requireProjectId(value.projectId);
  requireExactKeys(value.provenance, PROVENANCE_KEYS, 'candidate.provenance');
  for (const key of ['sourceType', 'sourceId', 'author', 'license']) requireText(value.provenance[key], `candidate.provenance.${key}`);
  requireIso(value.provenance.retrievedAt, 'candidate.provenance.retrievedAt');
  requireDigest(value.provenance.contentSha256, 'candidate.provenance.contentSha256');
  requireIso(value.createdAt, 'candidate.createdAt');
  return clone({ ...value, classification: 'Insufficient Evidence' });
}

function emptyGates() { return Object.fromEntries(REQUIRED_LEARNING_GATES.map((gate) => [gate, false])); }
function appendHistory(record, to, at, reason) {
  requireIso(at, 'transition.at'); requireText(reason, 'transition.reason');
  record.history.push({ from: record.state, to, at, reason }); record.state = to;
}
function requireState(record, expected, action) { if (record.state !== expected) throw new Error(`${action} requires ${expected} state; found ${record.state}.`); }
function validateExperiment(value, candidate) {
  const keys = ['hypothesis', 'testedProperty', 'experimentBoundary', 'controls', 'causalIsolation', 'negativeTests', 'regressionTests', 'scopeProof', 'generalizationResult', 'contradictionResult', 'completedAt'];
  requireExactKeys(value, keys, 'experiment');
  for (const key of ['hypothesis', 'testedProperty', 'experimentBoundary', 'scopeProof', 'generalizationResult', 'contradictionResult']) requireText(value[key], `experiment.${key}`);
  for (const key of ['controls', 'negativeTests', 'regressionTests']) requireTextArray(value[key], `experiment.${key}`);
  requireExactKeys(value.causalIsolation, ['method', 'result', 'correlationOnly'], 'experiment.causalIsolation');
  requireText(value.causalIsolation.method, 'experiment.causalIsolation.method'); requireText(value.causalIsolation.result, 'experiment.causalIsolation.result');
  if (value.causalIsolation.correlationOnly !== false) throw new Error('Correlation never satisfies causation.');
  requireIso(value.completedAt, 'experiment.completedAt');
  if (value.testedProperty !== candidate.claim) throw new Error('An experiment may test only the candidate claim.');
  if (value.experimentBoundary !== candidate.claimBoundary) throw new Error('Experimental results inherit the candidate claim boundary.');
  return clone(value);
}

async function readJsonOr(path, fallback) {
  try { return JSON.parse(await readWorkspaceText(path)); }
  catch (error) { if (/not found/i.test(String(error?.message || ''))) return clone(fallback); throw error; }
}
async function writeJson(path, value) {
  return nexus.call('workspace:write', { operation: 'write', overwrite: true, files: [{ path, content: `${JSON.stringify(value, null, 2)}\n`, encoding: 'utf-8' }] });
}
async function loadLearning(projectId) {
  const id = requireProjectId(projectId);
  const candidates = await readJsonOr(learningPath(id, 'candidates'), { schemaVersion: 1, projectId: id, revision: 0, records: [] });
  const knowledge = await readJsonOr(learningPath(id, 'verified-knowledge'), { schemaVersion: 1, projectId: id, revision: 0, activeVersion: null, versions: [] });
  if (candidates.schemaVersion !== 1 || candidates.projectId !== id || !Array.isArray(candidates.records)) throw new Error('Candidate store identity or schema is invalid.');
  if (knowledge.schemaVersion !== 1 || knowledge.projectId !== id || !Array.isArray(knowledge.versions)) throw new Error('Verified-knowledge store identity or schema is invalid.');
  return { candidates, knowledge };
}
function findRecord(store, candidateId) { const record = store.records.find((item) => item.candidate.id === candidateId); if (!record) throw new Error('Candidate record does not exist in this project.'); return record; }
async function saveCandidates(store) { store.revision += 1; await writeJson(learningPath(store.projectId, 'candidates'), store); }
async function saveKnowledge(store) { store.revision += 1; await writeJson(learningPath(store.projectId, 'verified-knowledge'), store); }
function learningTelemetry(actionId, projectId, state) { nexus.emitTelemetry('crucible.learning.action', { version: VERSION, actionId, projectId, state, evidentiary: false }); }

function requireWebCrypto() {
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.subtle || typeof webCrypto.getRandomValues !== 'function') throw new Error('Nexus host must provide standard Web Crypto with subtle and getRandomValues.');
  return webCrypto;
}
function utf8(value) { return new TextEncoder().encode(value); }
function b64urlEncode(bytes) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlDecode(value, label = 'base64url value') {
  requireText(value, label); if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${label} must use base64url encoding.`);
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/'); const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  let binary; try { binary = atob(padded); } catch { throw new Error(`${label} must use base64url encoding.`); }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function sha256Hex(bytes) {
  return Array.from(new Uint8Array(await requireWebCrypto().subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function requireConfiguredMasterKey(masterKey, configuration) {
  const raw = b64urlDecode(masterKey, 'masterKey');
  if (raw.length < 32) throw new Error('masterKey must contain at least 32 bytes.');
  if (await sha256Hex(raw) !== configuration.masterKeySha256) throw new Error('Ephemeral transport key does not match this project configuration.');
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function deriveWeeklyKey(masterKey, projectId) {
  const raw = b64urlDecode(masterKey, 'masterKey'); if (raw.length < 32) throw new Error('masterKey must contain at least 32 bytes.');
  const subtle = requireWebCrypto().subtle; const material = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8(projectId), info: utf8('the-crucible-weekly-learning-v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function validateWeeklyIdentity(payload, binding) {
  requireExactKeys(payload, ['schemaVersion', 'projectId', 'week', 'candidateEvidence', 'verifiedKnowledge'], 'weekly payload');
  if (payload.schemaVersion !== 1 || payload.projectId !== binding.projectId || payload.week !== binding.week) throw new Error('Weekly payload identity mismatch.');
  if (!Array.isArray(payload.candidateEvidence) || !Array.isArray(payload.verifiedKnowledge)) throw new Error('Weekly payload collections must be arrays.');
  for (const key of ['projectId', 'repository', 'week', 'oidcSubject']) requireText(binding[key], `weekly binding.${key}`);
}
async function encryptWeeklyPayload(payload, { masterKey, projectId, repository, week, oidcSubject }) {
  const binding = { schemaVersion: 1, projectId, repository, week, oidcSubject }; validateWeeklyIdentity(payload, binding);
  const cryptoApi = requireWebCrypto(); const iv = cryptoApi.getRandomValues(new Uint8Array(12)); const key = await deriveWeeklyKey(masterKey, projectId);
  const encrypted = new Uint8Array(await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(canonical(binding)), tagLength: 128 }, key, utf8(canonical(payload))));
  const tag = encrypted.slice(encrypted.length - 16); const ciphertext = encrypted.slice(0, -16);
  return { ...binding, algorithm: 'A256GCM-HKDF-SHA256', iv: b64urlEncode(iv), ciphertext: b64urlEncode(ciphertext), tag: b64urlEncode(tag) };
}
async function decryptWeeklyPayload(envelope, { masterKey, expectedProjectId, expectedRepository, expectedWeek, expectedOidcSubject }) {
  requireExactKeys(envelope, ['schemaVersion', 'projectId', 'repository', 'week', 'oidcSubject', 'algorithm', 'iv', 'ciphertext', 'tag'], 'weekly envelope');
  if (envelope.schemaVersion !== 1 || envelope.algorithm !== 'A256GCM-HKDF-SHA256' || envelope.projectId !== expectedProjectId || envelope.repository !== expectedRepository || envelope.week !== expectedWeek || envelope.oidcSubject !== expectedOidcSubject) throw new Error('Weekly envelope binding mismatch.');
  const binding = { schemaVersion: 1, projectId: envelope.projectId, repository: envelope.repository, week: envelope.week, oidcSubject: envelope.oidcSubject };
  const ciphertext = b64urlDecode(envelope.ciphertext, 'envelope.ciphertext'); const tag = b64urlDecode(envelope.tag, 'envelope.tag'); const combined = new Uint8Array(ciphertext.length + tag.length); combined.set(ciphertext); combined.set(tag, ciphertext.length);
  const key = await deriveWeeklyKey(masterKey, envelope.projectId); let decrypted;
  try { decrypted = await requireWebCrypto().subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(envelope.iv, 'envelope.iv'), additionalData: utf8(canonical(binding)), tagLength: 128 }, key, combined); }
  catch { throw new Error('Weekly envelope authentication failed.'); }
  return JSON.parse(new TextDecoder().decode(decrypted));
}
async function verifyOidcToken(token, { jwks, issuer, audience, repository, ref, projectId, now = Date.now() }) {
  requireText(token, 'OIDC token'); const parts = token.split('.'); if (parts.length !== 3) throw new Error('OIDC token must be a compact JWT.');
  let header; let claims; try { header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0], 'OIDC header'))); claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1], 'OIDC claims'))); } catch (error) { throw new Error(`OIDC token JSON is invalid: ${error.message}`); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new Error('OIDC token must use RS256 with kid.');
  const jwk = jwks?.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA'); if (!jwk) throw new Error('OIDC signing key is not trusted.');
  const key = await requireWebCrypto().subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await requireWebCrypto().subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2], 'OIDC signature'), utf8(`${parts[0]}.${parts[1]}`)); if (!valid) throw new Error('OIDC signature is invalid.');
  if (claims.iss !== issuer || claims.aud !== audience || claims.repository !== repository || claims.ref !== ref || claims.project_id !== projectId) throw new Error('OIDC identity is not bound to the expected project/repository/ref.');
  const seconds = Math.floor(now / 1000); if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > seconds + 60 || claims.exp <= seconds || claims.exp - claims.iat > 600) throw new Error('OIDC token lifetime is invalid.');
  return clone(claims);
}

async function learningConfigurationAction(payload) {
  const projectId = requireProjectId(payload.projectId ?? payload.identity?.projectId);
  if (payload.actionId === 'crucible-learning-readiness') {
    const configuration = await readLearningConfiguration(projectId, false);
    return configuration ? { ok: true, ready: true, configuration } : { ok: true, ready: false, projectId, missing: ['trusted OIDC configuration', 'OIDC subject binding', 'ephemeral transport key commitment'] };
  }
  if (payload.actionId !== 'crucible-learning-configure') throw new Error(`Unknown learning configuration action: ${payload.actionId}`);
  if (await readLearningConfiguration(projectId, false)) throw new Error('Scientific learning is already configured for this project; refusing to replace trusted identity or key binding implicitly.');
  const identity = payload.identity; requireObject(identity, 'identity');
  if (requireProjectId(identity.projectId) !== projectId) throw new Error('Learning configuration project identity mismatch.');
  const claims = await verifyOidcToken(payload.oidcToken, identity);
  const oidcSubject = requireText(payload.oidcSubject, 'oidcSubject');
  if (claims.sub !== oidcSubject) throw new Error('OIDC subject binding mismatch.');
  requireIso(payload.configuredAt, 'configuredAt');
  const rawKey = b64urlDecode(payload.masterKey, 'masterKey');
  if (rawKey.length < 32) throw new Error('masterKey must contain at least 32 bytes.');
  const configuration = validateLearningConfiguration({
    schemaVersion: 1, status: 'ready', projectId, issuer: identity.issuer, audience: identity.audience,
    repository: identity.repository, ref: identity.ref, oidcSubject,
    jwks: { keys: identity.jwks?.keys?.map((key) => ({ kty: key.kty, kid: key.kid, alg: key.alg, n: key.n, e: key.e })) },
    masterKeySha256: await sha256Hex(rawKey), configuredAt: payload.configuredAt
  }, projectId);
  await writeJson(learningPath(projectId, 'configuration'), configuration);
  learningTelemetry(payload.actionId, projectId, 'ready');
  return { ok: true, ready: true, configuration };
}

async function learningTransportAction(payload) {
  const projectId = requireProjectId(payload.projectId ?? payload.identity?.projectId);
  const configuration = await readLearningConfiguration(projectId);
  const identity = { jwks: configuration.jwks, issuer: configuration.issuer, audience: configuration.audience, repository: configuration.repository, ref: configuration.ref, projectId };
  const claims = await verifyOidcToken(payload.oidcToken, identity);
  if (claims.sub !== configuration.oidcSubject || payload.oidcSubject !== configuration.oidcSubject) throw new Error('OIDC subject binding mismatch.');
  if (payload.actionId !== 'crucible-learning-oidc-verify') await requireConfiguredMasterKey(payload.masterKey, configuration);
  let result;
  if (payload.actionId === 'crucible-learning-weekly-encrypt') result = await encryptWeeklyPayload(payload.weeklyPayload, { masterKey: payload.masterKey, projectId, repository: identity.repository, week: payload.week, oidcSubject: claims.sub });
  else if (payload.actionId === 'crucible-learning-weekly-decrypt') result = await decryptWeeklyPayload(payload.envelope, { masterKey: payload.masterKey, expectedProjectId: projectId, expectedRepository: identity.repository, expectedWeek: payload.week, expectedOidcSubject: claims.sub });
  else if (payload.actionId === 'crucible-learning-oidc-verify') result = claims;
  else throw new Error(`Unknown learning transport action: ${payload.actionId}`);
  learningTelemetry(payload.actionId, projectId, 'transported'); return { ok: true, result };
}

async function learningAction(payload) {
  const projectId = requireProjectId(payload.projectId ?? payload.candidate?.projectId);
  if (payload.candidate && requireProjectId(payload.candidate.projectId) !== projectId) throw new Error('Cross-project candidate evidence is forbidden.');
  if (payload.actionId !== 'crucible-learning-retrieve') await readLearningConfiguration(projectId);
  const { candidates, knowledge } = await loadLearning(projectId);
  if (payload.actionId === 'crucible-learning-ingest') {
    const candidate = validateLearningCandidate(payload.candidate);
    if (candidate.projectId !== projectId) throw new Error('Cross-project candidate evidence is forbidden.');
    if (candidates.records.some((item) => item.candidate.id === candidate.id)) throw new Error('Candidate id already exists.');
    const record = { schemaVersion: 1, candidate, state: 'candidate', gates: emptyGates(), experiment: null, independentVerification: null, proofSha256: null, history: [{ from: null, to: 'candidate', at: candidate.createdAt, reason: 'strictly validated candidate evidence ingested' }] };
    candidates.records.push(record); await saveCandidates(candidates); learningTelemetry(payload.actionId, projectId, record.state); return { ok: true, record: clone(record) };
  }
  if (payload.actionId === 'crucible-learning-retrieve') return { ok: true, projectId, candidates: clone(candidates.records), knowledge: clone(knowledge) };
  if (payload.actionId === 'crucible-learning-rollback') {
    requireIso(payload.at, 'rollback.at'); requireText(payload.reason, 'rollback.reason');
    if (!Number.isInteger(payload.targetVersion) || payload.targetVersion < 1) throw new Error('rollback.targetVersion must be a positive integer.');
    const target = knowledge.versions.find((item) => item.version === payload.targetVersion); if (!target) throw new Error('Rollback target does not exist.');
    for (const item of knowledge.versions) if (item.status === 'active') item.status = 'rolled-back';
    target.status = 'active'; target.rollback = { at: payload.at, reason: payload.reason }; knowledge.activeVersion = target.version;
    await saveKnowledge(knowledge); learningTelemetry(payload.actionId, projectId, 'rolled-back'); return { ok: true, knowledge: clone(knowledge) };
  }
  const record = findRecord(candidates, requireText(payload.candidateId, 'candidateId'));
  if (payload.actionId === 'crucible-learning-hypothesis') {
    requireState(record, 'candidate', 'hypothesis declaration'); requireText(payload.hypothesis, 'hypothesis'); requireIso(payload.at, 'transition.at');
    record.hypothesis = payload.hypothesis.trim(); record.gates.falsifiableHypothesis = true; appendHistory(record, 'hypothesis', payload.at, 'falsifiable hypothesis declared separately from experiment evidence');
  } else if (payload.actionId === 'crucible-learning-experiment') {
    requireState(record, 'hypothesis', 'experiment recording'); const experiment = validateExperiment(payload.experiment, record.candidate);
    if (experiment.hypothesis !== record.hypothesis) throw new Error('Experiment hypothesis must match the separately declared hypothesis.');
    record.experiment = experiment;
    for (const gate of ['controlledReproduction', 'controlTesting', 'negativeTesting', 'regressionTesting', 'deterministicScopeProof', 'claimBoundaryCheck', 'generalizationCheck', 'contradictionAnalysis']) record.gates[gate] = true;
    appendHistory(record, 'experimented', experiment.completedAt, 'controlled experiment recorded; later proof stages remain unsatisfied');
  } else if (payload.actionId === 'crucible-learning-causal-confirm') {
    requireState(record, 'experimented', 'causal confirmation'); if (!record.experiment || record.experiment.causalIsolation.correlationOnly !== false) throw new Error('Causal isolation proof is required.');
    requireIso(payload.at, 'transition.at'); record.gates.causalIsolation = true; appendHistory(record, 'causally-proven', payload.at, 'causal isolation independently confirmed from experiment record');
  } else if (payload.actionId === 'crucible-learning-independent-verify') {
    requireState(record, 'causally-proven', 'independent verification'); const verification = payload.verification;
    requireExactKeys(verification, ['verifierId', 'independent', 'testedProperty', 'experimentBoundary', 'result', 'verifiedAt', 'proofSha256'], 'verification');
    requireText(verification.verifierId, 'verification.verifierId'); if (verification.independent !== true) throw new Error('Independent verification is required.');
    if (verification.verifierId === record.candidate.provenance.author || verification.verifierId === record.candidate.provenance.sourceId) throw new Error('Verifier is not independent from candidate provenance.');
    if (verification.testedProperty !== record.candidate.claim) throw new Error('Verification proves only the tested property.');
    if (verification.experimentBoundary !== record.candidate.claimBoundary) throw new Error('Experimental results inherit experiment boundaries.');
    if (verification.result !== 'passed') throw new Error('Independent verification must pass.'); requireIso(verification.verifiedAt, 'verification.verifiedAt'); requireDigest(verification.proofSha256, 'verification.proofSha256');
    record.independentVerification = clone(verification); record.proofSha256 = verification.proofSha256; record.gates.independentVerification = true; appendHistory(record, 'independently-verified', verification.verifiedAt, 'separate independent verification passed');
  } else if (payload.actionId === 'crucible-learning-promote') {
    requireState(record, 'independently-verified', 'verified promotion'); requireIso(payload.at, 'transition.at');
    if (PROHIBITED_PROMOTION_KINDS.includes(record.candidate.kind)) throw new Error(`${record.candidate.kind} can never be promoted.`);
    const missing = REQUIRED_LEARNING_GATES.filter((gate) => record.gates[gate] !== true); if (missing.length) throw new Error(`Verified promotion is fail-closed; missing gate(s): ${missing.join(', ')}.`);
    if (record.experiment.contradictionResult !== 'none') throw new Error('Contradictions require quarantine.');
    const conflict = knowledge.versions.find((item) => item.status === 'active' && item.boundary === record.candidate.claimBoundary && item.claim !== record.candidate.claim);
    if (conflict) {
      record.candidate.classification = 'Crucible Issue'; record.contradiction = { conflictingVersion: conflict.version };
      appendHistory(record, 'quarantined', payload.at, 'contradiction with active verified knowledge detected');
      await saveCandidates(candidates); learningTelemetry(payload.actionId, projectId, record.state); return { ok: false, quarantined: true, record: clone(record), knowledge: clone(knowledge) };
    }
    appendHistory(record, 'verified', payload.at, 'all mandatory scientific proof gates passed');
    const previousVersion = knowledge.activeVersion; if (previousVersion) knowledge.versions.find((item) => item.version === previousVersion).status = 'superseded';
    const version = { version: knowledge.versions.length + 1, projectId, candidateId: record.candidate.id, claim: record.candidate.claim, boundary: record.experiment.experimentBoundary, proofSha256: record.proofSha256, previousVersion, createdAt: payload.at, status: 'active' };
    knowledge.versions.push(version); knowledge.activeVersion = version.version; await saveKnowledge(knowledge);
  } else if (payload.actionId === 'crucible-learning-quarantine' || payload.actionId === 'crucible-learning-reject') {
    if (['verified', 'quarantined', 'rejected'].includes(record.state)) throw new Error(`Cannot ${payload.actionId} a terminal learning record.`);
    requireIso(payload.at, 'transition.at'); requireText(payload.reason, 'transition.reason'); const to = payload.actionId.endsWith('quarantine') ? 'quarantined' : 'rejected'; record.candidate.classification = to === 'quarantined' ? 'Crucible Issue' : 'Rejected Evidence'; appendHistory(record, to, payload.at, payload.reason);
  } else throw new Error(`Unknown learning action: ${payload.actionId}`);
  await saveCandidates(candidates); learningTelemetry(payload.actionId, projectId, record.state); return { ok: true, record: clone(record), knowledge: clone(knowledge) };
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function isGovernancePath(value) {
  const normalized = normalizePath(value);
  if (!normalized.startsWith(`${GOVERNANCE_ROOT}/`)) return false;
  const relative = normalized.slice(GOVERNANCE_ROOT.length + 1);
  return Boolean(relative) && !relative.split('/').some((part) => !part || part === '.' || part === '..');
}

function requireGovernancePath(value) {
  const normalized = normalizePath(value);
  if (!isGovernancePath(normalized)) throw new Error('Governance operations are restricted to files inside governingDocuments/.');
  return normalized;
}

function normalizeBranchName(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty branch name.`);
  return value.trim();
}

function normalizeRequiredPaths(link) {
  const raw = link.requiredPaths ?? link.requiredMainPaths ?? [];
  if (!Array.isArray(raw)) throw new Error('canonical-reference required paths must be an array.');
  return raw.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error('canonical-reference required paths must be non-empty strings.');
    return normalizePath(item);
  });
}

function classifyBranchLinks(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('BRANCH-LINKS.json must contain an object.');
  if (raw.schemaVersion !== 1) throw new Error('BRANCH-LINKS.json schemaVersion must be 1.');
  if (!Array.isArray(raw.links)) throw new Error('BRANCH-LINKS.json links must be an array.');

  const canonicalReferences = [];
  const pairedRelationships = [];
  for (const link of raw.links) {
    if (!link || typeof link !== 'object' || Array.isArray(link)) throw new Error('BRANCH-LINKS.json link entries must be objects.');
    const relationship = link.relationship || link.type;
    if (relationship === 'canonical-reference') {
      const sourceBranch = normalizeBranchName(link.branch ?? link.sourceBranch, 'canonical-reference source branch');
      const targetBranch = normalizeBranchName(link.dependsOn ?? link.targetBranch ?? raw.canonicalBranch, 'canonical-reference target branch');
      canonicalReferences.push({
        relationship: 'canonical-reference',
        sourceBranch,
        targetBranch,
        requiredPaths: normalizeRequiredPaths(link),
        automaticRepair: link.automaticRepair || null
      });
      continue;
    }
    if (relationship === 'paired' || relationship === 'lifecycle-pair') {
      const rawBranches = link.branches || [link.branch, link.pairedWith].filter(Boolean);
      if (!Array.isArray(rawBranches) || rawBranches.length < 2) throw new Error('paired relationship must declare at least two branches.');
      const branches = rawBranches.map((entry, index) => {
        if (typeof entry === 'string') return { branch: normalizeBranchName(entry, `paired branch ${index + 1}`), role: null };
        if (!entry || typeof entry !== 'object') throw new Error('paired relationship branch entries must be strings or objects.');
        return { branch: normalizeBranchName(entry.branch ?? entry.name, `paired branch ${index + 1}`), role: typeof entry.role === 'string' ? entry.role : null };
      });
      pairedRelationships.push({ relationship: 'paired', branches });
      continue;
    }
    throw new Error(`Unsupported branch relationship: ${String(relationship)}`);
  }
  return { schemaVersion: 1, canonicalReferences, pairedRelationships };
}

function action(id, label, description, extra = {}) {
  return Object.freeze({ id, label, description, ...extra });
}

async function listLocalGovernance() {
  const result = await nexus.call('workspace:read', { operation: 'list', path: GOVERNANCE_ROOT, recursive: true, textOnly: true });
  return (result?.files || [])
    .map((item) => typeof item === 'string' ? item : item.path)
    .filter((item) => isGovernancePath(item))
    .sort();
}

async function readWorkspaceText(path) {
  const result = await nexus.call('workspace:read', { operation: 'read', path, encoding: 'utf-8' });
  return String(result?.content || '');
}

function undeclaredBranchRelationships() {
  return { ok: true, declared: false, manifestPath: BRANCH_LINK_MANIFEST, schemaVersion: 1, canonicalReferences: [], pairedRelationships: [] };
}

async function readBranchRelationships() {
  return readWorkspaceText(BRANCH_LINK_MANIFEST).then((content) => JSON.parse(content)).then((parsed) => {
    return { ok: true, declared: true, manifestPath: BRANCH_LINK_MANIFEST, ...classifyBranchLinks(parsed) };
  }, (error) => {
    if (/not found/i.test(String(error?.message || ''))) {
      return undeclaredBranchRelationships();
    }
    return { ok: false, declared: true, manifestPath: BRANCH_LINK_MANIFEST, error: String(error?.message || error) };
  });
}

async function readLocalGovernance(payload) {
  const path = requireGovernancePath(payload.path);
  return { ok: true, path, content: await readWorkspaceText(path) };
}

async function writeLocalGovernance(payload) {
  const path = requireGovernancePath(payload.path);
  if (path === REFERENCE_MANIFEST && payload.allowReferenceManifestEdit !== true) {
    throw new Error('CRUCIBLE-REFERENCES.json is managed by Auto Inject. Use explicit reference-manifest override only when intentionally replacing canonical references.');
  }
  if (typeof payload.content !== 'string') throw new Error('Governance content must be text.');
  const result = await nexus.call('workspace:write', {
    operation: 'write',
    overwrite: payload.overwrite === true,
    files: [{ path, content: payload.content, encoding: 'utf-8' }]
  });
  nexus.emitTelemetry('crucible.governance.write', { version: VERSION, path, overwrite: payload.overwrite === true });
  return { ok: true, path, result };
}

async function deleteLocalGovernance(payload) {
  const path = requireGovernancePath(payload.path);
  if (payload.confirmed !== true) return { ok: false, requiresConfirmation: true, path };
  const result = await nexus.call('workspace:write', { operation: 'delete', paths: [path] });
  nexus.emitTelemetry('crucible.governance.delete', { version: VERSION, path });
  return { ok: true, path, result };
}

async function moveLocalGovernance(payload) {
  const from = requireGovernancePath(payload.from);
  const to = requireGovernancePath(payload.to);
  if (payload.confirmed !== true) return { ok: false, requiresConfirmation: true, from, to };
  const result = await nexus.call('workspace:write', {
    operation: 'move',
    overwrite: payload.overwrite === true,
    moves: [{ from, to }]
  });
  nexus.emitTelemetry('crucible.governance.move', { version: VERSION, from, to, overwrite: payload.overwrite === true });
  return { ok: true, from, to, result };
}

async function previewAutoInject() {
  let exists = false;
  try { await readWorkspaceText(REFERENCE_MANIFEST); exists = true; } catch (_) {}
  return {
    ok: true,
    selectedByDefault: false,
    requiresConfirmation: true,
    writes: [{ path: REFERENCE_MANIFEST, exists, defaultOverwrite: false }],
    canonicalDocuments: canonicalReferenceManifest().documents,
    branchRelationshipRule: 'Project-specific branch names and dependency paths come from governingDocuments/BRANCH-LINKS.json; examples are never treated as naming rules.'
  };
}

async function autoInject(payload) {
  if (payload.selected !== true || payload.confirmed !== true) {
    return { ok: false, requiresSelection: true, requiresConfirmation: true, message: 'Auto Inject is off by default and requires explicit selection plus confirmation.' };
  }
  const manifest = `${JSON.stringify(canonicalReferenceManifest(), null, 2)}\n`;
  const result = await nexus.call('workspace:write', {
    operation: 'write',
    overwrite: payload.overwrite === true,
    files: [{ path: REFERENCE_MANIFEST, content: manifest, encoding: 'utf-8' }]
  });
  nexus.emitTelemetry('crucible.plugin.auto-injected', { version: VERSION, referenceCount: CANONICAL_DOCUMENTS.length });
  return {
    ok: true,
    written: [REFERENCE_MANIFEST],
    canonicalRepository: CANONICAL_REPOSITORY,
    canonicalBranch: CANONICAL_BRANCH,
    branchLinkManifest: BRANCH_LINK_MANIFEST,
    message: 'The Crucible reference manifest was installed. Branch relationships remain project-specific and are read from governingDocuments/BRANCH-LINKS.json when present.',
    result
  };
}

async function projectAction(payload = {}) {
  if (['crucible-learning-configure', 'crucible-learning-readiness'].includes(payload.actionId)) return learningConfigurationAction(payload);
  if (['crucible-learning-oidc-verify', 'crucible-learning-weekly-encrypt', 'crucible-learning-weekly-decrypt'].includes(payload.actionId)) return learningTransportAction(payload);
  if (typeof payload.actionId === 'string' && payload.actionId.startsWith('crucible-learning-')) return learningAction(payload);
  switch (payload.actionId) {
    case 'crucible-auto-inject-preview': return previewAutoInject();
    case 'crucible-auto-inject': return autoInject(payload);
    case 'crucible-branch-links-read': return readBranchRelationships();
    case 'crucible-governance-list': return { ok: true, localFiles: await listLocalGovernance(), canonical: canonicalReferenceManifest().documents };
    case 'crucible-governance-read': return readLocalGovernance(payload);
    case 'crucible-governance-write': return writeLocalGovernance(payload);
    case 'crucible-governance-delete': return deleteLocalGovernance(payload);
    case 'crucible-governance-move': return moveLocalGovernance(payload);
    default:
      return {
        plugin: PLUGIN_NAME,
        pluginId: PLUGIN_ID,
        version: VERSION,
        canonicalSource: { repository: CANONICAL_REPOSITORY, branch: CANONICAL_BRANCH },
        configuration: {
          type: 'governance-reference-and-overlay',
          referenceManifest: REFERENCE_MANIFEST,
          branchLinkManifest: BRANCH_LINK_MANIFEST,
          branchRelationshipTypes: ['canonical-reference', 'paired'],
          branchNamesAreProjectData: true,
          sharedDocumentsAreReadOnlyReferences: true,
          localOverlayRoot: GOVERNANCE_ROOT,
          localOperations: ['list', 'read', 'create', 'update', 'move', 'delete'],
          destructiveOperationsRequireConfirmation: true
          ,scientificLearning: {
            enabled: true,
            setupRequiredBeforeEvidence: true,
            storageRoot: LEARNING_ROOT,
            projectIsolated: true,
            telemetryIsEvidence: false,
            prohibitedDirectPromotionKinds: PROHIBITED_PROMOTION_KINDS,
            requiredGates: REQUIRED_LEARNING_GATES,
            weeklyTransport: 'web-crypto-rs256-oidc-a256gcm-hkdf-sha256',
            masterKeyPersistence: 'forbidden'
          }
        },
        actions: [
          action('crucible-auto-inject', 'Auto Inject The Crucible', 'Install canonical references after explicit confirmation.', { selectable: true, selectedByDefault: false, requiresConfirmation: true }),
          action('crucible-branch-links-read', 'Inspect branch relationships', 'Identify project-declared paired and canonical-reference relationships without relying on example branch names.'),
          action('crucible-configure-governance', 'Configure project governance', 'Manage project-specific governance overlays without copying canonical Crucible policy files.', { opensConfiguration: true }),
          action('crucible-open-canonical', 'Open canonical Crucible governance', 'Use the default Crucible branch as the shared source of truth.', { references: canonicalReferenceManifest().documents })
          ,action('crucible-learning-configure', 'Learning: Configure secure project', 'Bind the project ID, trusted OIDC identity, OIDC subject, and ephemeral transport-key commitment before evidence intake.')
          ,action('crucible-learning-readiness', 'Learning: Check readiness', 'Report whether secure project learning configuration is complete without accepting evidence.')
          ,action('crucible-learning-ingest', 'Learning: Ingest candidate evidence', 'After secure setup, validate and store project-isolated candidate evidence as Insufficient Evidence.')
          ,action('crucible-learning-hypothesis', 'Learning: Declare hypothesis', 'Declare a falsifiable hypothesis without satisfying any experiment or proof stage.')
          ,action('crucible-learning-experiment', 'Learning: Record controlled experiment', 'Record bounded controlled experiment evidence; later causal and verification stages remain separate.')
          ,action('crucible-learning-causal-confirm', 'Learning: Confirm causal isolation', 'Confirm causal isolation; correlation is never accepted as causation.')
          ,action('crucible-learning-independent-verify', 'Learning: Independently verify', 'Record a separate independent verifier result for exactly the tested property and boundary.')
          ,action('crucible-learning-promote', 'Learning: Promote verified knowledge', 'Promote only after every mandatory gate passes; fail closed otherwise.')
          ,action('crucible-learning-retrieve', 'Learning: Retrieve project knowledge', 'Retrieve isolated candidates and versioned verified knowledge; retrieval is not proof.')
          ,action('crucible-learning-rollback', 'Learning: Roll back knowledge', 'Restore a prior verified-knowledge version with a timestamped reason.')
          ,action('crucible-learning-oidc-verify', 'Learning: Verify OIDC identity', 'Verify a trusted RS256 token with exact issuer, audience, repository, ref, project, and lifetime binding.')
          ,action('crucible-learning-weekly-encrypt', 'Learning: Encrypt weekly envelope', 'Encrypt a project-bound weekly payload with an ephemeral master key using HKDF and AES-256-GCM.')
          ,action('crucible-learning-weekly-decrypt', 'Learning: Decrypt weekly envelope', 'Authenticate identity and project/repository/week/subject bindings before decrypting a weekly payload.')
        ]
      };
  }
}

register({
  onActivate() { nexus.emitTelemetry('crucible.plugin.activated', { version: VERSION }); },
  onDeactivate() { nexus.emitTelemetry('crucible.plugin.deactivated', { version: VERSION }); },
  slots: {
    'project-actions': projectAction,
    'inspector-panel': async () => ({
      title: PLUGIN_NAME,
      pluginId: PLUGIN_ID,
      version: VERSION,
      canonicalSource: { repository: CANONICAL_REPOSITORY, branch: CANONICAL_BRANCH },
      referenceManifest: REFERENCE_MANIFEST,
      branchLinkManifest: BRANCH_LINK_MANIFEST,
      branchRelationships: await readBranchRelationships(),
      localGovernanceFiles: await listLocalGovernance().catch(() => []),
      canonicalDocuments: canonicalReferenceManifest().documents,
      autoInject: { selectedByDefault: false, requiresConfirmation: true }
      ,scientificLearning: { enabled: true, setupRequiredBeforeEvidence: true, storageRoot: LEARNING_ROOT, telemetryIsEvidence: false, weeklyTransport: 'web-crypto-rs256-oidc-a256gcm-hkdf-sha256', masterKeyPersistence: 'forbidden' }
    }),
    'command-palette': async () => ({
      commands: [
        action('crucible.inject', 'Crucible: Auto Inject references', 'Install the reference manifest after explicit confirmation.', { selectable: true, selectedByDefault: false }),
        action('crucible.links', 'Crucible: Inspect branch relationships', 'Read project-specific branch-link governance without assuming naming conventions.'),
        action('crucible.configure', 'Crucible: Configure local governance', 'Manage project-specific governance overlays.'),
        action('crucible.canonical', 'Crucible: Open canonical governance', 'Open shared governance from the default Crucible branch.', { references: canonicalReferenceManifest().documents })
        ,action('crucible.learning', 'Crucible: Scientific learning', 'Open project-isolated candidate, experiment, verification, promotion, and knowledge retrieval actions.')
      ]
    })
  }
});
