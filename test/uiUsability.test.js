const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('main navigation keeps accessible labels and visible plain-English names', () => {
  const ids = [
    'tab-btn-projects', 'tab-btn-workspace', 'tab-btn-editor', 'tab-btn-apitester',
    'tab-btn-docker', 'tab-btn-packages', 'tab-btn-recentchanges', 'tab-btn-pipeline',
    'tab-btn-aitools', 'tab-btn-activity', 'tab-btn-cloud',
  ];

  for (const id of ids) {
    assert.match(html, new RegExp(`id=["']${id}["'][^>]*aria-label=["'][^"']+["']`));
    assert.match(css, new RegExp(`#${id}::after\\s*\\{\\s*content:`));
  }
});

test('home screen includes an always-visible three-step getting-started guide', () => {
  assert.match(css, /#view-projects::before/);
  assert.match(css, /1\. Open an existing project/);
  assert.match(css, /2\. Press Launch/);
  assert.match(css, /3\. Open Run & Preview/);
});

test('navigation is a readable sidebar instead of an icon-only rail', () => {
  assert.match(css, /--sidebar-width:\s*236px/);
  assert.match(css, /\.nav-btn\s*\{[\s\S]*grid-template-columns:\s*30px 1fr/);
  assert.match(css, /#tab-btn-projects::after\s*\{\s*content:\s*["']Home & Projects["']/);
  assert.match(css, /#tab-btn-workspace::after\s*\{\s*content:\s*["']Run & Preview["']/);
  assert.match(css, /#tab-btn-cloud::after\s*\{\s*content:\s*["']Settings & Keys["']/);
});
