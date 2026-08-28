const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Settings and Keys always scrolls to profiles, connected services, and API keys', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(css, /\.view-pane:not\(#view-workspace\)\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.view-pane:not\(#view-workspace\)\s*\{[^}]*scrollbar-width:\s*none/);
  assert.match(css, /\.view-pane:not\(#view-workspace\)::\-webkit-scrollbar\s*\{[^}]*display:\s*none/);
  const profile = html.indexOf('id="nexus-profile-title"');
  const services = html.indexOf('id="connected-services-title"');
  const keys = html.indexOf('id="coding-model-provider"');
  assert.ok(profile > html.indexOf('id="view-cloud"'));
  assert.ok(services > profile);
  assert.ok(keys > services);
});

test('every ordinary page scrolls while the workspace retains its internal pane layout', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const views = [...html.matchAll(/<div id="(view-[^"]+)" class="view-pane/g)].map(match => match[1]);
  assert.deepEqual(views.sort(), ['view-cloud', 'view-projects', 'view-workspace']);
  assert.match(css, /\.view-pane:not\(#view-workspace\)/);
  assert.match(css, /\.view-pane\s*\{[^}]*overflow:\s*hidden/);
});

test('ordinary pages scroll without permanent retro scrollbar tracks', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.doesNotMatch(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /\*::\-webkit-scrollbar\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(css, /scrollbar-width:\s*thin/);
});

test('Settings and Keys is divided into focused sections instead of one scroll fest', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  for (const section of ['account', 'github', 'system', 'updates']) assert.match(html, new RegExp(`data-settings-section="${section}"`));
  assert.match(renderer, /function setSettingsSection\(section\)/);
  assert.match(renderer, /card\.hidden = settingsSectionForCard\(card\) !== currentSettingsSection/);
  assert.match(css, /\.settings-section-nav\s*\{[^}]*position:\s*sticky/);
});

test('legacy GitHub settings routes safely to the real GitHub settings section', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  assert.match(renderer, /requestedSettings = tabId === 'settings'/);
  assert.match(renderer, /if \(requestedSettings\) tabId = 'cloud'/);
  assert.match(renderer, /requestedSettings \? 'github'/);
  assert.match(renderer, /if \(!view \|\| !button\)/);
});
