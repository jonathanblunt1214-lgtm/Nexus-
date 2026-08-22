const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectGameProject, GUIDES } = require('../gameProjectDetector');

function project(t) { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-game-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true })); return folder; }

test('detects native game engines from high-confidence project markers', (t) => {
  const unity = project(t); fs.mkdirSync(path.join(unity, 'ProjectSettings')); fs.mkdirSync(path.join(unity, 'Assets')); fs.writeFileSync(path.join(unity, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000');
  assert.equal(detectGameProject(unity).type, 'unity');
  const godot = project(t); fs.writeFileSync(path.join(godot, 'project.godot'), '[application]');
  assert.equal(detectGameProject(godot).type, 'godot');
  const unreal = project(t); fs.writeFileSync(path.join(unreal, 'MyGame.uproject'), '{}');
  assert.equal(detectGameProject(unreal).type, 'unreal');
});

test('detects dedicated web-game frameworks without labeling ordinary web apps', (t) => {
  const game = project(t); fs.writeFileSync(path.join(game, 'package.json'), JSON.stringify({ dependencies: { phaser: '^3.0.0' } }));
  assert.equal(detectGameProject(game).type, 'webgame');
  const website = project(t); fs.writeFileSync(path.join(website, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0', three: '^0.1.0' } }));
  assert.equal(detectGameProject(website).isGame, false);
});

test('every game classification teaches the official tool and documentation destination', () => {
  for (const guide of Object.values(GUIDES)) { assert.match(guide.url, /^https:\/\//); assert.match(guide.docsUrl, /^https:\/\//); assert.ok(guide.tool); assert.ok(guide.reason); }
});

test('Projects UI keeps Nexus responsibilities separate from engine-specific development', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer.js'), 'utf8');
  assert.match(html, /Game Development Guide/);
  assert.match(html, /Nexus is still useful/);
  assert.match(html, /official getting-started guide/);
  assert.match(renderer, /backfillGameProjectClassifications/);
  assert.match(renderer, /Where to develop it/);
});
