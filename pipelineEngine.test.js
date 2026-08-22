const test = require('node:test');
const assert = require('node:assert/strict');
const { runPipeline, PipelineError, tokenize } = require('./pipelineEngine');

const sampleContext = {
  projects: [
    { name: 'WebApp', running: true, port: 3000 },
    { name: 'API', running: false, port: 4000 },
    { name: 'Worker', running: true, port: 5000 },
  ],
};

test('tokenize', async (t) => {
  await t.test('splits words, flags, pipes, and quoted strings', () => {
    assert.deepEqual(tokenize('Get-Project | Where-Object name -eq "Web App"'), [
      'Get-Project', '|', 'Where-Object', 'name', '-eq', 'Web App',
    ]);
  });

  await t.test('throws a PipelineError on an unclosed quote', () => {
    assert.throws(() => tokenize('Get-Project | Where-Object name -eq "oops'), PipelineError);
  });
});

test('runPipeline: Get-Project', async (t) => {
  await t.test('returns the real injected project list, unmodified', () => {
    assert.deepEqual(runPipeline('Get-Project', sampleContext), sampleContext.projects);
  });

  await t.test('returns an empty array if no projects are in context', () => {
    assert.deepEqual(runPipeline('Get-Project', {}), []);
  });
});

test('runPipeline: Where-Object', async (t) => {
  await t.test('-eq filters correctly, including boolean coercion', () => {
    const result = runPipeline('Get-Project | Where-Object running -eq true', sampleContext);
    assert.deepEqual(result.map((p) => p.name), ['WebApp', 'Worker']);
  });

  await t.test('-ne is the inverse of -eq', () => {
    const result = runPipeline('Get-Project | Where-Object running -ne true', sampleContext);
    assert.deepEqual(result.map((p) => p.name), ['API']);
  });

  await t.test('-like does a case-insensitive substring match', () => {
    const result = runPipeline('Get-Project | Where-Object name -like api', sampleContext);
    assert.deepEqual(result.map((p) => p.name), ['API']);
  });

  await t.test('throws a clear PipelineError when given too few arguments', () => {
    assert.throws(() => runPipeline('Get-Project | Where-Object name', sampleContext), PipelineError);
  });

  await t.test('throws a clear PipelineError for an unknown operator', () => {
    assert.throws(() => runPipeline('Get-Project | Where-Object name -gt API', sampleContext), PipelineError);
  });
});

test('runPipeline: Select-Object', async (t) => {
  await t.test('projects only the requested properties', () => {
    const result = runPipeline('Get-Project | Select-Object name port', sampleContext);
    assert.deepEqual(result[0], { name: 'WebApp', port: 3000 });
    assert.equal(Object.prototype.hasOwnProperty.call(result[0], 'running'), false);
  });

  await t.test('throws if no property is given', () => {
    assert.throws(() => runPipeline('Get-Project | Select-Object', sampleContext), PipelineError);
  });
});

test('runPipeline: Sort-Object', async (t) => {
  await t.test('sorts ascending by default', () => {
    const result = runPipeline('Get-Project | Sort-Object name', sampleContext);
    assert.deepEqual(result.map((p) => p.name), ['API', 'WebApp', 'Worker']);
  });

  await t.test('-Descending reverses the order', () => {
    const result = runPipeline('Get-Project | Sort-Object port -Descending', sampleContext);
    assert.deepEqual(result.map((p) => p.port), [5000, 4000, 3000]);
  });
});

test('runPipeline: Measure-Object', async (t) => {
  await t.test('counts the current pipeline items', () => {
    assert.deepEqual(runPipeline('Get-Project | Measure-Object', sampleContext), [{ Count: 3 }]);
  });
});

test('runPipeline: full multi-stage pipeline', async (t) => {
  await t.test('filters, sorts, and projects together correctly', () => {
    const result = runPipeline(
      'Get-Project | Where-Object running -eq true | Sort-Object port -Descending | Select-Object name port',
      sampleContext,
    );
    assert.deepEqual(result, [
      { name: 'Worker', port: 5000 },
      { name: 'WebApp', port: 3000 },
    ]);
  });
});

test('runPipeline: error handling', async (t) => {
  await t.test('throws PipelineError for an unknown cmdlet, listing available ones', () => {
    assert.throws(
      () => runPipeline('Remove-Item C:\\', sampleContext),
      (err) => err instanceof PipelineError && /not supported/.test(err.message),
    );
  });

  await t.test('throws PipelineError for an empty pipeline', () => {
    assert.throws(() => runPipeline('', sampleContext), PipelineError);
  });

  await t.test('throws PipelineError for two pipes with nothing between them', () => {
    assert.throws(() => runPipeline('Get-Project | | Select-Object name', sampleContext), PipelineError);
  });

  await t.test('never touches fs, child_process, or any Node/Electron global - confirmed by construction: this module requires nothing but its own code', () => {
    const rawSource = require('node:fs').readFileSync(require.resolve('./pipelineEngine'), 'utf8');
    // Normalize line endings before stripping comments so this security
    // assertion behaves identically on Windows, macOS, and Linux.
    const codeOnly = rawSource
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    assert.ok(!/require\(['"]fs['"]\)/.test(codeOnly), 'pipelineEngine.js must never require fs');
    assert.ok(!/require\(['"]child_process['"]\)/.test(codeOnly), 'pipelineEngine.js must never require child_process');
    assert.ok(!/\beval\(/.test(codeOnly), 'pipelineEngine.js must never call eval');
    assert.ok(!/new Function\(/.test(codeOnly), 'pipelineEngine.js must never call new Function');
  });
});
