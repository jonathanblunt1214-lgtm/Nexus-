const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { PROJECT_TEMPLATES, getProjectTemplate } = require('../projectTemplates');

test('offers Website, App, and API templates with concrete generation requirements', () => {
  assert.deepEqual(Object.keys(PROJECT_TEMPLATES), ['website', 'app', 'api']);
  for (const template of Object.values(PROJECT_TEMPLATES)) {
    assert.ok(template.label);
    assert.ok(template.description);
    assert.ok(template.requirements.length > 40);
    assert.match(template.port, /^\d+$/);
  }
  assert.equal(getProjectTemplate('unknown'), null);
});

test('Create New Project displays all templates and passes the selection through the narrow bridge', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer.js'), 'utf8');
  const preload = fs.readFileSync(require.resolve('../preload.js'), 'utf8');
  assert.match(html, /value="website"/);
  assert.match(html, /value="app"/);
  assert.match(html, /value="api"/);
  assert.match(renderer, /generateNewProject\(name, description, templateId\)/);
  assert.match(preload, /generate-new-project.*templateId/);
});
