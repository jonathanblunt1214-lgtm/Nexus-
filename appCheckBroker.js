// Obtains Firebase App Check tokens for Nexus's Electron main process.
//
// Nexus talks to Firebase Authentication and Firestore with raw REST calls
// from the main process (see firebaseAccountClient.js) rather than the
// Firebase JS SDK, so it cannot attest itself the normal browser way. This
// module gets a token instead by loading a small hidden, sandboxed page (the
// "broker", see firebase-hosting/appcheck-broker/) on Nexus's own Firebase
// Hosting origin, where a reCAPTCHA Enterprise site key is registered and
// restricted to that exact domain. The broker exchanges a reCAPTCHA token
// for an App Check token and reports it back over a narrow, contextIsolated
// IPC bridge (appCheckBrokerPreload.js) — the token never reaches the
// visible Nexus UI, a URL, a log line, or disk. It is cached in memory only,
// for the lifetime of the running process.
//
// App Check stays optional: if no broker URL is configured, or the broker
// fails for any reason, getAppCheckToken() resolves to null and callers
// proceed without the X-Firebase-AppCheck header, exactly as Nexus behaves
// today. This module never blocks real Firebase traffic on its own account.

const { BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');

const BROKER_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

const BROKER_CSP = [
  "default-src 'none'",
  "script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
  "connect-src 'self' https://content-firebaseappcheck.googleapis.com https://www.google.com/recaptcha/",
  "frame-src https://www.google.com/recaptcha/",
  "img-src 'self' https://www.gstatic.com/recaptcha/",
  "style-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

let cachedToken = null; // { token, expiresAtMs } — memory only; never persisted, never logged.
let pendingRequest = null;

function isTokenFresh() {
  return Boolean(cachedToken && cachedToken.expiresAtMs > Date.now() + TOKEN_REFRESH_MARGIN_MS);
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

async function fetchFreshToken(brokerUrl) {
  const origin = originOf(brokerUrl);
  if (!origin || !/^https:$/.test(new URL(brokerUrl).protocol)) throw new Error('Configure a valid HTTPS App Check broker URL first.');

  const partitionName = `appcheck-broker-${crypto.randomBytes(8).toString('hex')}`;
  const brokerSession = session.fromPartition(partitionName);
  brokerSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [BROKER_CSP] } });
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: brokerSession,
      preload: path.join(__dirname, 'appCheckBrokerPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on('will-navigate', (event, url) => { if (originOf(url) !== origin) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for an App Check token.')); }, BROKER_TIMEOUT_MS);
      const onToken = (event, payload) => {
        if (event.sender !== win.webContents) return;
        cleanup();
        resolve({ token: payload.token, expiresAtMs: payload.expiresAtMs });
      };
      const onError = (event, payload) => {
        if (event.sender !== win.webContents) return;
        cleanup();
        reject(new Error(payload.message || 'App Check broker reported an error.'));
      };
      function cleanup() {
        clearTimeout(timer);
        ipcMain.removeListener('appcheck-broker:token', onToken);
        ipcMain.removeListener('appcheck-broker:error', onError);
      }
      ipcMain.on('appcheck-broker:token', onToken);
      ipcMain.on('appcheck-broker:error', onError);
      win.loadURL(brokerUrl).catch((error) => { cleanup(); reject(error); });
    });
    if (!result.token || !(result.expiresAtMs > Date.now())) throw new Error('The App Check broker returned an invalid token.');
    cachedToken = result;
    return cachedToken.token;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function getAppCheckToken(brokerUrl) {
  if (!brokerUrl) return null;
  if (isTokenFresh()) return cachedToken.token;
  if (!pendingRequest) pendingRequest = fetchFreshToken(brokerUrl).finally(() => { pendingRequest = null; });
  try { return await pendingRequest; }
  catch { return null; }
}

module.exports = { getAppCheckToken };
