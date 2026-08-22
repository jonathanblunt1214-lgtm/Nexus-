const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { queryLanguageIntelligence } = require('../languageIntelligence');

function project() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-language-'));
  fs.writeFileSync(path.join(folder, 'math.ts'), 'export function double(value: number) { return value * 2; }\n', 'utf8');
  fs.writeFileSync(path.join(folder, 'app.ts'), "import { double } from './math';\nconst answer = double(21);\nconsole.log(answer);\n", 'utf8');
  return folder;
}

test('provides definitions, references, hover information, symbols, and diagnostics', () => {
  const folder = project();
  const filePath = path.join(folder, 'app.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  const position = { folder, filePath, content, line: 1, column: 17 };
  assert.equal(queryLanguageIntelligence({ ...position, action: 'definition' }).locations[0].file, 'math.ts');
  assert.ok(queryLanguageIntelligence({ ...position, action: 'references' }).locations.length >= 1);
  assert.match(queryLanguageIntelligence({ ...position, action: 'hover' }).hover.signature, /double/);
  assert.ok(queryLanguageIntelligence({ ...position, action: 'symbols' }).symbols.some((item) => item.name === 'answer'));
  assert.deepEqual(queryLanguageIntelligence({ ...position, action: 'diagnostics' }).diagnostics, []);
});

test('rename returns concrete multi-file edits without writing files', () => {
  const folder = project();
  const filePath = path.join(folder, 'app.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  const result = queryLanguageIntelligence({ folder, filePath, content, line: 1, column: 17, action: 'rename', newName: 'timesTwo' });
  assert.equal(result.ok, true);
  assert.ok(result.files.some((file) => file.content.includes('timesTwo')));
  assert.match(fs.readFileSync(filePath, 'utf8'), /double/);
});

test('completion returns real TypeScript service suggestions', () => {
  const folder = project();
  const filePath = path.join(folder, 'app.ts');
  const content = 'const value = Math.\n';
  const result = queryLanguageIntelligence({ folder, filePath, content, line: 0, column: 19, action: 'complete' });
  assert.equal(result.ok, true);
  assert.ok(result.items.some((item) => item.name === 'max'));
});

test('packaged runtime includes TypeScript and skips irrelevant native grammar rebuilds', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies.typescript);
  assert.equal(pkg.build.npmRebuild, false);
  assert.ok(pkg.build.files.includes('languageIntelligence.js'));
});
