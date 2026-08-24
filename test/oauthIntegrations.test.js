const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('OAuth and Drive integrations use provider-approved restricted flows', () => {
  const oauth = fs.readFileSync(require.resolve('../oauthIntegrations'), 'utf8');
  const main = fs.readFileSync(require.resolve('../main'), 'utf8');
  assert.match(oauth, /urn:ietf:params:oauth:grant-type:device_code/);
  assert.match(oauth, /code_challenge_method.*S256/);
  assert.match(oauth, /127\.0\.0\.1/);
  assert.match(oauth, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
  assert.doesNotMatch(oauth, /auth\/drive['"]/);
  assert.match(main, /setEncryptedConfigValue\(cfg, 'googleRefreshToken'/);
});

test('renderer receives no OAuth token and Drive actions require explicit user choice', () => {
  const preload = fs.readFileSync(require.resolve('../preload'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer'), 'utf8');
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.match(html, /Connect GitHub/);
  assert.match(html, /Sign in with Google/);
  assert.match(html, /Upload file to Drive/);
  assert.match(preload, /googleDriveUpload: \(\) => ipcRenderer\.invoke\('drive:upload'\)/);
  assert.doesNotMatch(renderer, /access_token|refresh_token/);
});

test('GitHub connection is a guided token-free device flow with automatic copy and retry', () => {
  const oauth = fs.readFileSync(require.resolve('../oauthIntegrations'), 'utf8');
  const main = fs.readFileSync(require.resolve('../main'), 'utf8');
  const preload = fs.readFileSync(require.resolve('../preload'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer'), 'utf8');
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.match(html, /id="github-device-panel"/);
  assert.match(html, /No command line or personal access token is required/);
  assert.doesNotMatch(html, /id="github-token"/);
  assert.match(main, /clipboard\.writeText\(device\.user_code\)/);
  assert.match(main, /oauth:github-copy-code/);
  assert.match(preload, /githubOAuthCopyCode/);
  assert.match(renderer, /retryGitHubOAuthCompletion/);
  assert.match(oauth, /AbortSignal\.timeout\(30000\)/);
  assert.match(oauth, /consecutiveNetworkFailures < 5/);
  assert.match(main, /retryable = error\.code === 'GITHUB_NETWORK'/);
});

test('WordPress.com uses authorization code OAuth with an exact loopback callback and encrypted token storage', () => {
  const oauth = fs.readFileSync(require.resolve('../oauthIntegrations'), 'utf8');
  const main = fs.readFileSync(require.resolve('../main'), 'utf8');
  const preload = fs.readFileSync(require.resolve('../preload'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer'), 'utf8');
  assert.match(oauth, /public-api\.wordpress\.com\/oauth2\/authorize/);
  assert.match(oauth, /public-api\.wordpress\.com\/oauth2\/token/);
  assert.match(oauth, /127\.0\.0\.1:\$\{port\}\/oauth\/wordpress\/callback/);
  assert.match(oauth, /state validation failed/);
  assert.match(main, /setEncryptedConfigValue\(cfg, 'wordpressAccessToken'/);
  assert.match(preload, /wordpressOAuthConnect/);
  assert.doesNotMatch(renderer, /wordpressAccessToken|access_token/);
});

test('WordPress.com integration exposes bounded account site discovery', () => {
  const client = fs.readFileSync(require.resolve('../wordpressComClient'), 'utf8');
  const main = fs.readFileSync(require.resolve('../main'), 'utf8');
  assert.match(client, /\/rest\/v1\.1\/me\/sites/);
  assert.match(client, /route\.includes\('\.\.'\)/);
  assert.match(main, /wordpress:sites/);
});
