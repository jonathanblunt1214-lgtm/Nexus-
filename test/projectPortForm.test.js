const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('project form supports early auto-fill and validated manual port entry', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(html, /id="project-path"[^>]*onblur="detectAndFillProjectMetadata\(\)"/);
  assert.match(html, /type="number" id="project-port" min="1" max="65535"/);
  assert.match(renderer, /async function detectAndFillProjectPort/);
  assert.match(renderer, /You can change it before saving/);
  assert.match(renderer, /Number\(port\) > 65535/);
  assert.match(preload, /detectProjectPort:.*detect-project-port/);
  assert.match(main, /ipcMain\.handle\('detect-project-port'/);
  assert.match(html, /id="project-path"[^>]*onblur="detectAndFillProjectMetadata\(\)"/);
  assert.match(html, /id="project-port"[^>]*maxlength="5"[^>]*oninput=/);
  assert.match(renderer, /async function detectAndSelectProjectType/);
  assert.match(renderer, /async function detectAndFillProjectMetadata/);
  assert.match(renderer, /detectProjectType\(folder\)/);
  assert.match(renderer, /templateId, running: false/);
  assert.match(preload, /detectProjectType:.*detect-project-type/);
  assert.match(main, /ipcMain\.handle\('detect-project-type'/);
});
