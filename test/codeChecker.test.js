const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LANGUAGE_MAP } = require('../languageBreakdown');
const { checkCode, proposeCheckerFix, registerChecker, checkerCatalog } = require('../codeChecker');

function workspace(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-checker-'));
  t.after(() => fs.rmSync(folder, { recursive:true, force:true }));
  return folder;
}

test('every language Nexus recognizes has a checker adapter', async (t) => {
  const folder = workspace(t);
  for (const extension of Object.keys(LANGUAGE_MAP)) {
    const result = await checkCode({ folder, filePath:path.join(folder, `sample${extension}`), content:'', allowExternal:false });
    assert.equal(result.recognized, true, `missing checker for ${extension}`);
    assert.ok(result.checker, `missing checker id for ${extension}`);
  }
  assert.equal((await checkCode({ folder, filePath:path.join(folder, 'Dockerfile'), content:'FROM node:20' })).recognized, true);
  assert.ok(checkerCatalog().every((adapter) => adapter.correctionAdapter), 'every checker needs a deterministic correction adapter');
});

test('built-in JSON, YAML, markup, and structural checks return normalized diagnostics', async (t) => {
  const folder = workspace(t);
  const samples = [
    ['bad.json', '{"missing":}', 'JSON'],
    ['bad.yml', 'items:\n  - ok\n broken', 'YAML'],
    ['bad.html', '<main><section></main>', 'HTML'],
    ['bad.css', '.card { color: red;', 'Stylesheet'],
  ];
  for (const [name, content, source] of samples) {
    const result = await checkCode({ folder, filePath:path.join(folder, name), content, allowExternal:false });
    assert.equal(result.ok, true);
    assert.ok(result.diagnostics.length, `${name} should report a diagnostic`);
    assert.ok(result.diagnostics.every((item) => Number.isInteger(item.line) && item.source.includes(source)));
  }
});

test('external language tools stay disabled until workspace commands are trusted', async (t) => {
  const folder = workspace(t);
  const result = await checkCode({ folder, filePath:path.join(folder, 'app.py'), content:'print("ok")', allowExternal:false });
  assert.equal(result.checker, 'python');
  assert.equal(result.available, false);
  assert.equal(result.restricted, true);
});

test('future languages can register a checker without changing editor IPC', async (t) => {
  registerChecker({ id:'future-test', language:'Future Test', extensions:['.future'], async check() { return { diagnostics:[] }; } });
  const folder = workspace(t);
  const result = await checkCode({ folder, filePath:path.join(folder, 'sample.future'), content:'future', allowExternal:false });
  assert.equal(result.checker, 'future-test');
  assert.ok(checkerCatalog().some((adapter) => adapter.id === 'future-test'));
});

test('checker fix database authors and independently verifies corrections without the coding AI', async (t) => {
  const folder = workspace(t);
  const filePath = path.join(folder, 'sample.ts');
  const content = 'const value = 1;\nvalue = 2;\n';
  fs.writeFileSync(filePath, content);
  const result = await proposeCheckerFix({ folder, filePath, content });
  assert.equal(result.available, true);
  assert.equal(result.source, 'TypeScript language service code-fix database');
  assert.equal(result.correctedContent, 'let value = 1;\nvalue = 2;\n');
  assert.ok(result.before.diagnostics.length);
  assert.deepEqual(result.after.diagnostics, []);
});

test('built-in checker fix databases correct JSON, markup, and structural languages', async (t) => {
  const folder = workspace(t);
  const samples = [
    ['sample.json', '{"ready": true,}', '{"ready": true}'],
    ['sample.html', '<main><section></main>', '<main><section></section></main>'],
    ['sample.css', '.card { color: red;', '.card { color: red;}'],
  ];
  for (const [name, content, expected] of samples) {
    const result = await proposeCheckerFix({ folder, filePath:path.join(folder, name), content });
    assert.equal(result.available, true, `${name} should have a verified checker-authored fix`);
    assert.equal(result.correctedContent, expected);
    assert.deepEqual(result.after.diagnostics, []);
  }
});

test('coding AI receives checker evidence and autonomous edits reject checker errors', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  assert.match(main, /NEXUS CODE CHECKER RESULT/);
  assert.match(main, /checkerPromptContext\(folder, filePath/);
  assert.match(main, /Nexus code checker rejected the generated file/);
  assert.match(renderer, /blocked the autonomous fix because the code checker found/);
  assert.match(main, /Do not generate, modify, replace, or approve any code/);
});
