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
  assert.match(html, /Sign in with GitHub/);
  assert.match(html, /Sign in with Google/);
  assert.match(html, /Upload file to Drive/);
  assert.match(preload, /googleDriveUpload: \(\) => ipcRenderer\.invoke\('drive:upload'\)/);
  assert.doesNotMatch(renderer, /access_token|refresh_token/);
});
