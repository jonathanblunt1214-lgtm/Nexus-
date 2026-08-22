const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('modern shell uses text-first navigation without legacy emoji as the primary affordance', () => {
  assert.match(styles, /\.nav-btn\s*\{[\s\S]*?font-size:\s*0/);
  for (const label of [
    'Home & Projects',
    'Run & Preview',
    'Edit Code',
    'Test an API',
    'Containers',
    'Libraries',
    'History',
    'Automation',
    'AI Tools',
    'Activity',
    'Settings & Keys',
  ]) {
    assert.ok(styles.includes(label), `missing readable navigation label: ${label}`);
  }
});

test('modern shell keeps navigation readable at compact Electron widths', () => {
  assert.match(styles, /@media\s*\(max-width:\s*860px\)/);
  assert.match(styles, /#sidebar\s*\{[\s\S]*?flex-direction:\s*row/);
  assert.match(styles, /\.nav-btn::after\s*\{[\s\S]*?font-size:\s*12px/);
});

test('modern shell avoids neon/retro global visual language', () => {
  assert.doesNotMatch(styles, /radial-gradient/i);
  assert.doesNotMatch(styles, /text-shadow/i);
  assert.doesNotMatch(styles, /box-shadow:\s*0\s+0\s+\d+px\s+var\(--emerald/i);
  assert.match(styles, /--accent:\s*#6ea8fe/i);
});

test('all existing navigation IDs remain present for renderer behavior', () => {
  for (const id of [
    'tab-btn-projects', 'tab-btn-workspace', 'tab-btn-editor', 'tab-btn-apitester',
    'tab-btn-docker', 'tab-btn-packages', 'tab-btn-recentchanges', 'tab-btn-pipeline',
    'tab-btn-aitools', 'tab-btn-activity', 'tab-btn-cloud',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing existing navigation id ${id}`);
  }
});
