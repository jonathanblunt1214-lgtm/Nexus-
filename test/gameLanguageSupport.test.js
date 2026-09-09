const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const support = require('../gameLanguageSupport');
const { getLanguageBreakdown } = require('../languageBreakdown');
const { checkCode } = require('../codeChecker');

function workspace(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-game-languages-'));
  t.after(() => fs.rmSync(folder, { recursive:true, force:true }));
  return folder;
}

test('shared game-language catalog covers GameMaker, Godot, and common shaders', () => {
  assert.equal(support.languageFor('player.gml').name, 'GameMaker Language');
  assert.equal(support.languageFor('player.gd').name, 'GDScript');
  assert.equal(support.languageFor('water.shader').name, 'ShaderLab');
  assert.equal(support.languageFor('lighting.hlsl').name, 'HLSL');
  assert.equal(support.languageFor('post.frag').name, 'GLSL');
});

test('game source is counted in project language scans and structurally checked', async (t) => {
  const folder = workspace(t);
  const samples = [
    ['player.gml', 'function step() {\n'],
    ['player.gd', 'func step():\n  if ready: [\n'],
    ['lighting.hlsl', 'float4 main() {\n'],
    ['water.shader', 'Shader "Water" {\n'],
  ];
  for (const [name, content] of samples) fs.writeFileSync(path.join(folder, name), content);
  const breakdown = getLanguageBreakdown(folder);
  for (const expected of ['GameMaker Language', 'GDScript', 'HLSL', 'ShaderLab']) {
    assert.ok(breakdown.languages.some((language) => language.name === expected), `${expected} should be included in the scan`);
  }
  for (const [name, content] of samples) {
    const result = await checkCode({ folder, filePath:path.join(folder, name), content, allowExternal:false });
    assert.equal(result.recognized, true, `${name} should have a checker`);
    assert.ok(result.diagnostics.length, `${name} should report its unclosed structure`);
  }
});

test('the packaged editor loads the shared catalog before renderer and maps game files', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  assert.ok(html.indexOf('<script src="gameLanguageSupport.js"></script>') < html.indexOf('<script src="renderer.js"></script>'));
  assert.match(renderer, /nexusGameLanguageSupport\?\.editorModeFor/);
  assert.equal(support.editorModeFor('script.gml'), 'text/x-csrc');
  assert.equal(support.editorModeFor('script.gd'), 'python');
});
