const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCES, readSourceDocuments, searchSourceDocuments, searchWebDevelopmentKnowledge, buildLearningContext, curriculumInfo } = require('../webDevelopmentKnowledge');

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

test('complete supplied documents are packaged and searchable, including training directions', () => {
  const documents = readSourceDocuments();
  assert.equal(documents.length, 4);
  assert.ok(documents.every((document) => document.content.length > 100));
  assert.match(documents.find((document) => document.name === 'system_instruction.md.txt').content, /Continuous Improvement Loop/);
  assert.match(documents.find((document) => document.name === 'TECHNICAL_MANUAL.md.txt').content, /Recursive Prompt Optimization/);
  assert.match(documents.find((document) => document.name === 'scriptsprocess_logs.py.txt').content, /training_data\.jsonl/);
  assert.ok(searchSourceDocuments('recursive prompt optimization training').some((result) => result.source === 'TECHNICAL_MANUAL.md.txt'));
});

test('retrieval selects applicable web-development teaching', () => {
  const [result] = searchWebDevelopmentKnowledge('Improve keyboard accessibility and visible focus in this HTML form');
  assert.equal(result.id, 'semantic-accessibility');
  const context = buildLearningContext('Fix CLS caused by images');
  assert.match(context, /Web performance and Core Web Vitals/);
  assert.match(context, /NEXUS CODING AND WEB-DEVELOPMENT TRAINING MATERIAL/);
  assert.match(context, /Apply relevant operating guidance/);
});

test('coding model calls receive relevant content from the complete supplied training sources', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /buildLearningContext\(prompt\)/);
  assert.match(main, /CURRENT USER TASK/);
  assert.match(buildLearningContext('training logs corrective diff'), /corrective_diff/);
});
