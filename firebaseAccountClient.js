const AUTH_BASE = 'https://identitytoolkit.googleapis.com/v1';

function requireConfiguration(apiKey, projectId) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(String(apiKey || ''))) throw new Error('Configure the Firebase Web API key in Settings first.');
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(String(projectId || ''))) throw new Error('Configure a valid Firebase project ID in Settings first.');
}

function friendlyFirebaseError(code) {
  const messages = {
    EMAIL_EXISTS: 'An account already exists for this email address.',
    EMAIL_NOT_FOUND: 'No Nexus account was found for this email address.',
    INVALID_PASSWORD: 'The email address or password is incorrect.',
    INVALID_LOGIN_CREDENTIALS: 'The email address or password is incorrect.',
    USER_DISABLED: 'This Nexus account has been disabled.',
    OPERATION_NOT_ALLOWED: 'Email/password sign-in is not enabled for this Firebase project.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Wait a while and try again.',
    WEAK_PASSWORD: 'Choose a stronger password with at least six characters.',
    TOKEN_EXPIRED: 'Your Nexus email session expired. Sign in again.',
    INVALID_ID_TOKEN: 'Your Nexus email session is invalid. Sign in again.',
  };
  return messages[code] || `Firebase account request failed: ${code || 'unknown error'}`;
}

async function firebaseJson(url, body, options = {}) {
  const response = await fetch(url, { method: options.method || 'POST', headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.appCheckToken ? { 'X-Firebase-AppCheck': options.appCheckToken } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(friendlyFirebaseError(data?.error?.message?.split(' : ')[0]));
  return data;
}

async function signUp(apiKey, email, password, appCheckToken) {
  return firebaseJson(`${AUTH_BASE}/accounts:signUp?key=${encodeURIComponent(apiKey)}`, { email, password, returnSecureToken: true }, { appCheckToken });
}

async function signIn(apiKey, email, password, appCheckToken) {
  return firebaseJson(`${AUTH_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, { email, password, returnSecureToken: true }, { appCheckToken });
}

async function signInWithProvider(apiKey, { providerId, credential, credentialType = 'access_token', idToken = null, appCheckToken }) {
  if (!['google.com', 'github.com'].includes(providerId)) throw new Error('That Nexus account provider is not allowed.');
  if (!['access_token', 'id_token'].includes(credentialType) || !credential) throw new Error('The account provider did not return a usable credential.');
  const postBody = new URLSearchParams({ [credentialType]:credential, providerId }).toString();
  return firebaseJson(`${AUTH_BASE}/accounts:signInWithIdp?key=${encodeURIComponent(apiKey)}`, {
    requestUri:'http://localhost', postBody, ...(idToken ? { idToken } : {}), returnIdpCredential:true, returnSecureToken:true,
  }, { appCheckToken });
}

async function sendVerification(apiKey, idToken, appCheckToken) {
  return firebaseJson(`${AUTH_BASE}/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, { requestType: 'VERIFY_EMAIL', idToken }, { appCheckToken });
}

async function sendPasswordReset(apiKey, email, appCheckToken) {
  return firebaseJson(`${AUTH_BASE}/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, { requestType: 'PASSWORD_RESET', email }, { appCheckToken });
}

async function lookupAccount(apiKey, idToken, appCheckToken) {
  const data = await firebaseJson(`${AUTH_BASE}/accounts:lookup?key=${encodeURIComponent(apiKey)}`, { idToken }, { appCheckToken });
  const user = data.users?.[0];
  if (!user) throw new Error('The Nexus email account could not be found.');
  return { uid: user.localId, email: user.email, emailVerified: user.emailVerified === true };
}

async function refreshSession(apiKey, refreshToken, appCheckToken) {
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}) }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(friendlyFirebaseError(data?.error?.message));
  return { idToken: data.id_token, refreshToken: data.refresh_token, uid: data.user_id, expiresIn: data.expires_in };
}

function firestoreDocumentUrl(projectId, uid) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/nexusAccountVaults/${encodeURIComponent(uid)}`;
}

async function saveAccountVault({ apiKey, projectId, uid, idToken, encryptedVault, appCheckToken }) {
  requireConfiguration(apiKey, projectId);
  const updatedAt = new Date().toISOString();
  await firebaseJson(firestoreDocumentUrl(projectId, uid), { fields: { encryptedVault: { stringValue: encryptedVault }, updatedAt: { timestampValue: updatedAt }, schemaVersion: { integerValue: '1' } } }, { method: 'PATCH', token: idToken, appCheckToken });
  return { updatedAt };
}

async function loadAccountVault({ apiKey, projectId, uid, idToken, appCheckToken }) {
  requireConfiguration(apiKey, projectId);
  const response = await fetch(firestoreDocumentUrl(projectId, uid), { headers: { Authorization: `Bearer ${idToken}`, ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}) } });
  if (response.status === 404) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(friendlyFirebaseError(data?.error?.status || data?.error?.message));
  const content = data.fields?.encryptedVault?.stringValue;
  return content ? { content, modifiedTime: data.fields?.updatedAt?.timestampValue || data.updateTime, source: 'email' } : null;
}

module.exports = { requireConfiguration, signUp, signIn, signInWithProvider, sendVerification, sendPasswordReset, lookupAccount, refreshSession, saveAccountVault, loadAccountVault };
