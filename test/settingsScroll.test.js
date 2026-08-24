const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Settings and Keys always scrolls to profiles, connected services, and API keys', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(css, /#view-cloud\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /#view-cloud\s*\{[^}]*scrollbar-gutter:\s*stable/);
  const profile = html.indexOf('id="nexus-profile-title"');
  const services = html.indexOf('id="connected-services-title"');
  const keys = html.indexOf('id="coding-model-provider"');
  assert.ok(profile > html.indexOf('id="view-cloud"'));
  assert.ok(services > profile);
  assert.ok(keys > services);
});
