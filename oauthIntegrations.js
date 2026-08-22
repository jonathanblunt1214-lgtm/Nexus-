const http = require('http');
const crypto = require('crypto');

const jsonHeaders = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };

async function startGitHubDeviceFlow(clientId) {
  if (!clientId) throw new Error('This Nexus build has no GitHub OAuth client ID configured.');
  const body = new URLSearchParams({ client_id: clientId, scope: 'repo gist read:user user:email' });
  const response = await fetch('https://github.com/login/device/code', { method: 'POST', headers: jsonHeaders, body });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error_description || data.error || 'GitHub sign-in could not start.');
  return data;
}

async function pollGitHubDeviceFlow(clientId, device) {
  const deadline = Date.now() + Number(device.expires_in || 900) * 1000;
  let interval = Math.max(5, Number(device.interval || 5));
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    const body = new URLSearchParams({ client_id: clientId, device_code: device.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: jsonHeaders, body });
    const data = await response.json();
    if (data.access_token) return data;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { interval += 5; continue; }
    throw new Error(data.error_description || data.error || 'GitHub sign-in failed.');
  }
  throw new Error('GitHub sign-in expired. Try again.');
}

function base64Url(buffer) { return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }

async function authorizeGoogle({ clientId, clientSecret, openExternal, timeoutMs = 180000 }) {
  if (!clientId) throw new Error('This Nexus build has no Google OAuth client ID configured.');
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64Url(crypto.randomBytes(24));
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (url.pathname !== '/oauth2/callback' || url.searchParams.get('state') !== state) throw new Error('Google sign-in state validation failed.');
        const code = url.searchParams.get('code');
        if (!code) throw new Error(url.searchParams.get('error') || 'Google did not return an authorization code.');
        const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2/callback`;
        const body = new URLSearchParams({ client_id: clientId, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri });
        if (clientSecret) body.set('client_secret', clientSecret);
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: jsonHeaders, body });
        const tokens = await tokenResponse.json();
        if (!tokenResponse.ok) throw new Error(tokens.error_description || tokens.error || 'Google token exchange failed.');
        response.end('<h2>Google connected to Nexus</h2><p>You can close this window and return to Nexus.</p>');
        clearTimeout(timer); server.close(); resolve(tokens);
      } catch (error) { response.statusCode = 400; response.end('Google sign-in failed. Return to Nexus.'); clearTimeout(timer); server.close(); reject(error); }
    });
    const timer = setTimeout(() => { server.close(); reject(new Error('Google sign-in timed out.')); }, timeoutMs);
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2/callback`;
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' });
      openExternal(auth.toString());
    });
  });
}

async function refreshGoogleToken(clientId, clientSecret, refreshToken) {
  const body = new URLSearchParams({ client_id: clientId, refresh_token: refreshToken, grant_type: 'refresh_token' });
  if (clientSecret) body.set('client_secret', clientSecret);
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: jsonHeaders, body });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'Google session refresh failed.');
  return data;
}

module.exports = { startGitHubDeviceFlow, pollGitHubDeviceFlow, authorizeGoogle, refreshGoogleToken };
