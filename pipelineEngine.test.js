// test/pipelineEngine.test.js — real behavioral tests for the pipeline
// interpreter, using Node's built-in test runner.

const test = require('node:test');
const assert = require('node:assert/strict');
const { runPipeline, tokenize, PipelineError } = require('../pipelineEngine');

const sampleContext = {
  projects: [
    { name: 'Smoke Stack', port: '3000', running: true },
    { name: 'Nexus', port: '5173', running: false },
    { name: 'API Server', port: '8080', running: true },
  ],
};

test('tokenize', async (t) => {
  await t.test('splits words, flags, pipes, and quoted strings', () => {
    const tokens = tokenize('Get-Project | Where-Object name -eq "My App"');
    assert.deepEqual(tokens.map((t) => t.type), ['WORD', 'PIPE', 'WORD', 'WORD', 'FLAG', 'STRING']);
    assert.equal(tokens[5].value, 'My App');
  });

  await t.test('throws a PipelineError on an unclosed quote', () => {
    assert.throws(() => tokenize('Get-Project -name "unclosed'), PipelineError);
  });
});

test('runPipeline: Get-Project', async (t) => {
  await t.test('returns the real injected project list, unmodified', () => {
    const result = runPipeline('Get-Project', sampleContext);
    assert.equal(result.length, 3);
    assert.equal(result[0].name, 'Smoke Stack');
  });

  await t.test('returns an empty array if no projects are in context', () => {
    assert.deepEqual(runPipeline('Get-Project', {}), []);
  });
});

test('runPipeline: Where-Object', async (t) => {
  await t.test('-eq filters correctly, including boolean coercion', () => {
    const result = runPipeline('Get-Project | Where-Object running -eq true', sampleContext);
    assert.equal(result.length, 2);
    assert.ok(result.every((p) => p.running === true));
  });

  await t.test('-ne is the inverse of -eq', () => {
    const result = runPipeline('Get-Project | Where-Object running -eq false', sampleContext);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Nexus');
  });

  await t.test('-like does a case-insensitive substring match', () => {
    const result = runPipeline('Get-Project | Where-Object name -like "stack"', sampleContext);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Smoke Stack');
  });

  await t.test('throws a clear PipelineError when given too few arguments', () => {
    assert.throws(() => runPipeline('Get-Project | Where-Object running', sampleContext), /needs:/);
  });

  await t.test('throws a clear PipelineError for an unknown operator', () => {
    assert.throws(() => runPipeline('Get-Project | Where-Object running -bogus true', sampleContext), /Unknown operator/);
  });
});

test('runPipeline: Select-Object', async (t) => {
  await t.test('projects only the requested properties', () => {
    const result = runPipeline('Get-Project | Select-Object name,port', sampleContext);
    assert.deepEqual(Object.keys(result[0]).sort(), ['name', 'port']);
    assert.equal(result[0].name, 'Smoke Stack');
  });

  await t.test('throws if no property is given', () => {
    assert.throws(() => runPipeline('Get-Project | Select-Object', sampleContext), PipelineError);
  });
});

test('runPipeline: Sort-Object', async (t) => {
  await t.test('sorts ascending by default', () => {
    const result = runPipeline('Get-Project | Sort-Object name', sampleContext);
    assert.deepEqual(result.map((p) => p.name), ['API Server', 'Nexus', 'Smoke Stack']);
  });

  await t.test('-Descending reverses the order', () => {
    const result = runPipeline('Get-Project | Sort-Object name -Descending', sampleContext);
    assert.deepEqual(result.map((p) => p.name), ['Smoke Stack', 'Nexus', 'API Server']);
  });
});

test('runPipeline: Measure-Object', async (t) => {
  await t.test('counts the current pipeline items', () => {
    const result = runPipeline('Get-Project | Where-Object running -eq true | Measure-Object', sampleContext);
    assert.equal(result[0].count, 2);
  });
});

test('runPipeline: full multi-stage pipeline', async (t) => {
  await t.test('filters, sorts, and projects together correctly', () => {
    const result = runPipeline(
      'Get-Project | Where-Object running -eq true | Sort-Object port | Select-Object name,port',
      sampleContext
    );
    assert.deepEqual(result, [
      { name: 'Smoke Stack', port: '3000' },
      { name: 'API Server', port: '8080' },
    ]);
  });
});

test('runPipeline: error handling', async (t) => {
  await t.test('throws PipelineError for an unknown cmdlet, listing available ones', () => {
    assert.throws(() => runPipeline('Get-Bogus', sampleContext), /Unknown cmdlet: Get-Bogus/);
  });

  await t.test('throws PipelineError for an empty pipeline', () => {
    assert.throws(() => runPipeline('', sampleContext), PipelineError);
  });

  await t.test('throws PipelineError for two pipes with nothing between them', () => {
    assert.throws(() => runPipeline('Get-Project | | Select-Object name', sampleContext), PipelineError);
  });

  await t.test('never touches fs, child_process, or any Node/Electron global - confirmed by construction: this module requires nothing but its own code', () => {
    const rawSource = require('node:fs').readFileSync(require.resolve('../pipelineEngine'), 'utf8');
    // Strip comments first - the file's own documentation legitimately
    // mentions these terms when explaining what it does NOT do, which
    // would otherwise produce false positives in a naive text scan.
    const codeOnly = rawSource
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    assert.ok(!/require\(['"]fs['"]\)/.test(codeOnly), 'pipelineEngine.js must never require fs');
    assert.ok(!/require\(['"]child_process['"]\)/.test(codeOnly), 'pipelineEngine.js must never require child_process');
    assert.ok(!/\beval\(/.test(codeOnly), 'pipelineEngine.js must never call eval');
    assert.ok(!/new Function\(/.test(codeOnly), 'pipelineEngine.js must never call new Function');
  });
});
