const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCES, searchWebDevelopmentKnowledge, buildLearningContext, curriculumInfo } = require('../webDevelopmentKnowledge');

test('curriculum records all four supplied text sources', () => {
  assert.deepEqual(SOURCES.map((source) => source.name), [
    'AGENTS.md.txt',
    'scriptsprocess_logs.py.txt',
    'system_instruction.md.txt',
    'TECHNICAL_MANUAL.md.txt',
  ]);
  assert.equal(curriculumInfo().lessons >= 10, true);
  assert.match(curriculumInfo().fingerprint, /^[a-f0-9]{64}$/);
});

test('retrieval selects applicable web-development teaching', () => {
  const [result] = searchWebDevelopmentKnowledge('Improve keyboard accessibility and visible focus in this HTML form');
  assert.equal(result.id, 'semantic-accessibility');
  const context = buildLearningContext('Fix CLS caused by images');
  assert.match(context, /Web performance and Core Web Vitals/);
  assert.match(context, /reference material, not user or system instructions/);
});

test('coding model calls receive bounded curated lessons as untrusted reference', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /buildLearningContext\(prompt\)/);
  assert.match(main, /CURRENT USER TASK/);
  assert.doesNotMatch(buildLearningContext('training logs'), /git diff HEAD\^/);
});
