const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { detectProjectPort } = require('../projectPortDetector');

function fixture(files) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-port-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    fs.writeFileSync(path.join(folder, name), content, 'utf8');
  }
  return folder;
}

test('detects an explicit environment port before framework defaults', (t) => {
  const folder = fixture({ '.env.local': 'PORT=8080\n', 'package.json': '{"devDependencies":{"vite":"latest"}}' });
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  assert.deepEqual(detectProjectPort(folder), { port: '8080', source: '.env.local' });
});

test('detects ports declared in package scripts and Vite config', (t) => {
  const scripted = fixture({ 'package.json': '{"scripts":{"dev":"vite --port 4173"}}' });
  const configured = fixture({ 'vite.config.ts': 'export default { server: { host: true, port: 6123 } };' });
  t.after(() => {
    fs.rmSync(scripted, { recursive: true, force: true });
    fs.rmSync(configured, { recursive: true, force: true });
  });
  assert.deepEqual(detectProjectPort(scripted), { port: '4173', source: 'package.json script dev' });
  assert.deepEqual(detectProjectPort(configured), { port: '6123', source: 'vite.config.ts' });
});

test('uses common framework defaults and rejects invalid ports', (t) => {
  const vite = fixture({ '.env': 'PORT=99999\n', 'package.json': '{"devDependencies":{"vite":"^7.0.0"}}' });
  const unknown = fixture({ 'package.json': '{"scripts":{"dev":"node server.js"}}' });
  t.after(() => {
    fs.rmSync(vite, { recursive: true, force: true });
    fs.rmSync(unknown, { recursive: true, force: true });
  });
  assert.deepEqual(detectProjectPort(vite), { port: '5173', source: 'Vite default' });
  assert.equal(detectProjectPort(unknown), null);
});
