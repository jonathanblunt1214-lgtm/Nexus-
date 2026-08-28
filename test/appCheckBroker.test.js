const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const broker = fs.readFileSync(path.join(root, 'appCheckBroker.js'), 'utf8');
const brokerPreload = fs.readFileSync(path.join(root, 'appCheckBrokerPreload.js'), 'utf8');
const brokerPage = fs.readFileSync(path.join(root, 'firebase-hosting/appcheck-broker/broker.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

test('the App Check broker window is locked down: sandboxed, isolated, and confined to its own origin', () => {
  assert.match(broker, /contextIsolation:\s*true/);
  assert.match(broker, /nodeIntegration:\s*false/);
  assert.match(broker, /sandbox:\s*true/);
  assert.match(broker, /show:\s*false/);
  assert.match(broker, /preload:\s*path\.join\(__dirname,\s*['"]appCheckBrokerPreload\.js['"]\)/);
  assert.match(broker, /will-navigate.*originOf\(url\)\s*!==\s*origin/s);
  assert.match(broker, /setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*'deny'\s*\}\)\)/);
});

test('the broker Content-Security-Policy allows only the exact Firebase App Check and reCAPTCHA Enterprise hosts', () => {
  assert.match(broker, /default-src 'none'/);
  assert.match(broker, /content-firebaseappcheck\.googleapis\.com/);
  assert.match(broker, /www\.google\.com\/recaptcha\//);
  assert.match(broker, /www\.gstatic\.com\/recaptcha\//);
  assert.doesNotMatch(broker, /\*\.googleapis\.com|connect-src[^;]*\*/);
});

test('App Check tokens are cached only in memory and every failure path resolves to null instead of throwing', () => {
  assert.doesNotMatch(broker, /fs\.writeFile|localStorage|electron-store/);
  assert.match(broker, /catch\s*\{\s*return null;\s*\}/);
  assert.match(broker, /if \(!brokerUrl\) return null;/);
});

test('the broker preload exposes only a narrow, one-way token/error bridge via contextBridge', () => {
  assert.match(brokerPreload, /contextBridge\.exposeInMainWorld\('nexusAppCheckBridge'/);
  assert.match(brokerPreload, /reportToken:/);
  assert.match(brokerPreload, /reportError:/);
  assert.doesNotMatch(brokerPreload, /exposeInMainWorld\('nexus'/);
});

test('the hosted broker page exchanges a reCAPTCHA Enterprise token for an App Check token and never persists it', () => {
  assert.match(brokerPage, /recaptcha\/enterprise\.js\?render=/);
  assert.match(brokerPage, /exchangeRecaptchaEnterpriseToken/);
  assert.match(brokerPage, /window\.nexusAppCheckBridge/);
  assert.doesNotMatch(brokerPage, /localStorage\.|sessionStorage\.|document\.cookie\s*=|console\.(log|info|debug)\(/);
});

test('main.js resolves an App Check token best-effort and threads it into every Authentication and Firestore call', () => {
  assert.match(main, /appCheckBrokerUrl:\s*process\.env\.NEXUS_FIREBASE_APPCHECK_BROKER_URL/);
  assert.match(main, /async function currentAppCheckToken\(configuration\)/);
  assert.match(main, /catch\s*\{\s*return null;\s*\}/);
  for (const call of [
    /signInWithProvider\(configuration\.apiKey, \{ providerId, credential, credentialType, idToken:existing\?\.idToken \|\| null, appCheckToken \}\)/,
    /refreshSession\(configuration\.apiKey, refreshToken, appCheckToken\)/,
    /signUp\(configuration\.apiKey, email, password, appCheckToken\)/,
    /signIn\(configuration\.apiKey, email, password, appCheckToken\)/,
    /saveAccountVault\(\{[^}]*appCheckToken:\s*await currentAppCheckToken\(session\.configuration\)/,
    /loadAccountVault\(\{[^}]*appCheckToken:\s*await currentAppCheckToken\(session\.configuration\)/,
  ]) assert.match(main, call);
});

test('Firebase Hosting serves the broker with a matching restrictive CSP and the real broker config stays out of the repository', () => {
  const firebaseJson = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
  const brokerHeaders = firebaseJson.hosting.headers.find((entry) => entry.source === '/appcheck-broker/**');
  assert.ok(brokerHeaders, 'firebase.json must set headers for the broker path');
  const csp = brokerHeaders.headers.find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /content-firebaseappcheck\.googleapis\.com/);
  assert.match(csp, /www\.google\.com\/recaptcha\//);
  assert.ok(!fs.existsSync(path.join(root, 'firebase-hosting/appcheck-broker/config.json')), 'a filled-in broker config.json must never be committed');
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gitignore, /firebase-hosting\/appcheck-broker\/config\.json/);
});
