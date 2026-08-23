const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const client = require('../firebaseAccountClient');

function response(data, ok = true, status = 200) { return { ok, status, json: async () => data }; }

test('email sign-up and sign-in use Firebase Authentication without local password storage', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => { calls.push({ url, options }); return response({ localId:'uid-1', email:'person@example.com', idToken:'id-token', refreshToken:'refresh-token', expiresIn:'3600' }); };
  try {
    const signedUp = await client.signUp('A'.repeat(24), 'person@example.com', 'password-123');
    const signedIn = await client.signIn('A'.repeat(24), 'person@example.com', 'password-123');
    assert.equal(signedUp.localId, 'uid-1'); assert.equal(signedIn.idToken, 'id-token');
    assert.match(calls[0].url, /accounts:signUp/); assert.match(calls[1].url, /accounts:signInWithPassword/);
  } finally { global.fetch = originalFetch; }
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /setEncryptedConfigValue\(cfg, ['"]firebasePassword/);
});

test('refresh tokens are exchanged using the documented secure token endpoint', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => { assert.match(url, /securetoken\.googleapis\.com/); assert.match(String(options.body), /grant_type=refresh_token/); return response({ id_token:'new-id', refresh_token:'new-refresh', user_id:'uid-1', expires_in:'3600' }); };
  try { assert.deepEqual(await client.refreshSession('A'.repeat(24), 'refresh'), { idToken:'new-id', refreshToken:'new-refresh', uid:'uid-1', expiresIn:'3600' }); }
  finally { global.fetch = originalFetch; }
});

test('GitHub and Google credentials can sign in or link to one Firebase-backed Nexus account', async () => {
  const originalFetch = global.fetch; const bodies = [];
  global.fetch = async (_url, options) => { bodies.push(JSON.parse(options.body)); return response({ localId:'uid-1', idToken:'firebase-id', refreshToken:'firebase-refresh', expiresIn:'3600' }); };
  try {
    await client.signInWithProvider('A'.repeat(24), { providerId:'github.com', credential:'github-token', credentialType:'access_token' });
    await client.signInWithProvider('A'.repeat(24), { providerId:'google.com', credential:'google-id', credentialType:'id_token', idToken:'existing-firebase-id' });
  } finally { global.fetch = originalFetch; }
  assert.match(bodies[0].postBody, /access_token=github-token&providerId=github\.com/);
  assert.match(bodies[1].postBody, /id_token=google-id&providerId=google\.com/);
  assert.equal(bodies[1].idToken, 'existing-firebase-id');
});

test('unified account wiring never places provider tokens in renderer state or the portable vault inventory', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  assert.match(main, /establishNexusProviderAccount\('github\.com'/);
  assert.match(main, /establishNexusProviderAccount\('google\.com'/);
  assert.match(main, /linkedServices/);
  assert.doesNotMatch(renderer, /githubToken|googleAccessToken|firebaseRefreshToken/);
});

test('cloud storage is gated by an active Nexus account linked to that provider', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /function requireLinkedNexusProvider/);
  for (const operation of ['saveAccountVaultGist', 'loadAccountVaultGist']) assert.match(main, new RegExp(`requireLinkedNexusProvider\\('github\\.com', 'GitHub'\\)[^;]*;[^\\n]*${operation}`));
  assert.ok((main.match(/requireLinkedNexusProvider\('google\.com', 'Google'\)/g) || []).length >= 5);
  for (const channel of ['drive:list', 'drive:upload', 'drive:download']) assert.match(main, new RegExp(`${channel.replace(':', '\\:')}[^\\n]*requireLinkedNexusProvider\\('google\\.com', 'Google'\\)`));
});

test('Firestore vault path is UID-scoped and contains only encrypted vault data', async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => { captured = { url, options }; return response({}); };
  try { await client.saveAccountVault({ apiKey:'A'.repeat(24), projectId:'nexus-account-test', uid:'uid-123', idToken:'firebase-id', encryptedVault:'ciphertext-envelope' }); }
  finally { global.fetch = originalFetch; }
  assert.match(captured.url, /nexusAccountVaults\/uid-123/);
  assert.equal(captured.options.headers.Authorization, 'Bearer firebase-id');
  assert.match(captured.options.body, /ciphertext-envelope/);
  assert.doesNotMatch(captured.options.body, /apiKeys|password|refreshToken/);
});

test('Firestore rules isolate verified users to their own bounded vault document', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  assert.match(rules, /request\.auth\.uid == userId/);
  assert.match(rules, /email_verified == true/);
  assert.match(rules, /hasOnly\(\['encryptedVault', 'updatedAt', 'schemaVersion'\]\)/);
  assert.match(rules, /size\(\) <= 2097152/);
});
