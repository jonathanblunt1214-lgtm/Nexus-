// test/pureLogic.test.js — real behavioral tests, not smoke tests. Uses
// Node's built-in test runner (`node --test`), so this needs zero new
// dependencies added to Nexus itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeProjectFolderName,
  parseGeneratedFiles,
  detectStartCommand,
  escapeRegex,
  parseUnifiedDiff,
  parseJestStyleResults,
} = require('./pureLogic');

test('sanitizeProjectFolderName', async (t) => {
  await t.test('keeps a normal name unchanged apart from spacing', () => {
    assert.equal(sanitizeProjectFolderName('my-project'), 'my-project');
  });
  await t.test('replaces spaces with dashes', () => {
    assert.equal(sanitizeProjectFolderName('my cool project'), 'my-cool-project');
  });
  await t.test('strips characters that are unsafe in a folder name', () => {
    assert.equal(sanitizeProjectFolderName('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
  });
  await t.test('collapses multiple spaces into one dash', () => {
    assert.equal(sanitizeProjectFolderName('a    b'), 'a-b');
  });
  await t.test('falls back to a safe default if everything gets stripped', () => {
    assert.equal(sanitizeProjectFolderName('///???'), 'new-project');
  });
  await t.test('falls back to a safe default for an empty string', () => {
    assert.equal(sanitizeProjectFolderName(''), 'new-project');
  });
});

test('parseGeneratedFiles', async (t) => {
  await t.test('parses a single well-formed file block', () => {
    const input = '===FILE: index.js===\nconsole.log("hi");\n===END FILE===';
    const result = parseGeneratedFiles(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].relPath, 'index.js');
    assert.equal(result[0].content, 'console.log("hi");');
  });

  await t.test('parses multiple file blocks in one response', () => {
    const input = [
      '===FILE: a.js===',
      'content A',
      '===END FILE===',
      '===FILE: src/b.js===',
      'content B',
      '===END FILE===',
    ].join('\n');
    const result = parseGeneratedFiles(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].relPath, 'a.js');
    assert.equal(result[1].relPath, 'src/b.js');
    assert.equal(result[1].content, 'content B');
  });

  await t.test('returns an empty array for text with no file blocks', () => {
    assert.deepEqual(parseGeneratedFiles('just some plain text, no markers'), []);
  });

  await t.test('ignores a block with an empty file path', () => {
    const input = '===FILE:    ===\nsome content\n===END FILE===';
    assert.deepEqual(parseGeneratedFiles(input), []);
  });

  await t.test('strips exactly one leading/trailing newline, preserves internal blank lines', () => {
    const input = '===FILE: x.js===\n\nline1\n\nline2\n\n===END FILE===';
    const result = parseGeneratedFiles(input);
    assert.equal(result[0].content, 'line1\n\nline2\n');
  });
});

test('detectStartCommand', async (t) => {
  await t.test('prefers "dev" script when both dev and start exist', () => {
    const files = [{ relPath: 'package.json', content: JSON.stringify({ scripts: { dev: 'vite', start: 'node server.js' } }) }];
    assert.equal(detectStartCommand(files), 'npm run dev');
  });
  await t.test('falls back to "start" if only start exists', () => {
    const files = [{ relPath: 'package.json', content: JSON.stringify({ scripts: { start: 'node server.js' } }) }];
    assert.equal(detectStartCommand(files), 'npm start');
  });
  await t.test('defaults to "npm run dev" if no package.json is present', () => {
    assert.equal(detectStartCommand([{ relPath: 'README.md', content: '# hi' }]), 'npm run dev');
  });
  await t.test('defaults to "npm run dev" if package.json is malformed JSON', () => {
    const files = [{ relPath: 'package.json', content: '{ not valid json' }];
    assert.equal(detectStartCommand(files), 'npm run dev');
  });
  await t.test('defaults to "npm run dev" if package.json has no scripts at all', () => {
    const files = [{ relPath: 'package.json', content: '{}' }];
    assert.equal(detectStartCommand(files), 'npm run dev');
  });
});

test('escapeRegex', async (t) => {
  await t.test('escapes every regex special character', () => {
    const input = '.*+?^${}()|[]\\';
    const escaped = escapeRegex(input);
    // The escaped string, used as a regex, should match the original
    // literal string exactly - this is the real behavioral guarantee that
    // matters (used by project-wide search to treat user input as a plain
    // string, not as regex syntax).
    const pattern = new RegExp(escaped);
    assert.ok(pattern.test(input));
  });
  await t.test('leaves plain alphanumeric text unchanged', () => {
    assert.equal(escapeRegex('hello world 123'), 'hello world 123');
  });
  await t.test('a search for a literal "." only matches an actual dot, not any character', () => {
    const pattern = new RegExp(escapeRegex('a.b'));
    assert.ok(pattern.test('a.b'));
    assert.ok(!pattern.test('axb')); // would incorrectly match if "." wasn't escaped
  });
});

test('parseUnifiedDiff', async (t) => {
  await t.test('parses a single file with one hunk, correct add/del/context classification', () => {
    const diff = [
      'diff --git a/foo.js b/foo.js',
      'index abc123..def456 100644',
      '--- a/foo.js',
      '+++ b/foo.js',
      '@@ -1,3 +1,3 @@',
      ' unchanged line',
      '-removed line',
      '+added line',
    ].join('\n');
    const result = parseUnifiedDiff(diff);
    assert.equal(result.length, 1);
    assert.equal(result[0].relPath, 'foo.js');
    assert.equal(result[0].hunks.length, 1);
    const lines = result[0].hunks[0].lines;
    assert.deepEqual(lines[0], { type: 'context', text: 'unchanged line' });
    assert.deepEqual(lines[1], { type: 'del', text: 'removed line' });
    assert.deepEqual(lines[2], { type: 'add', text: 'added line' });
  });

  await t.test('parses multiple files in one diff', () => {
    const diff = [
      'diff --git a/one.js b/one.js',
      '--- a/one.js',
      '+++ b/one.js',
      '@@ -1 +1 @@',
      '+new in one',
      'diff --git a/two.js b/two.js',
      '--- a/two.js',
      '+++ b/two.js',
      '@@ -1 +1 @@',
      '+new in two',
    ].join('\n');
    const result = parseUnifiedDiff(diff);
    assert.equal(result.length, 2);
    assert.equal(result[0].relPath, 'one.js');
    assert.equal(result[1].relPath, 'two.js');
  });

  await t.test('returns an empty array for empty input', () => {
    assert.deepEqual(parseUnifiedDiff(''), []);
  });

  await t.test('ignores stray lines before any "diff --git" header', () => {
    const diff = 'some preamble noise\nmore noise\ndiff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n+hello';
    const result = parseUnifiedDiff(diff);
    assert.equal(result.length, 1);
    assert.equal(result[0].relPath, 'x.js');
  });
});

test('parseJestStyleResults', async (t) => {
  await t.test('parses passed, failed, and skipped tests correctly', () => {
    const json = JSON.stringify({
      numPassedTests: 1,
      numFailedTests: 1,
      numPendingTests: 1,
      testResults: [{
        assertionResults: [
          { fullName: 'adds numbers', status: 'passed', duration: 5 },
          { fullName: 'subtracts numbers', status: 'failed', duration: 3, failureMessages: ['Expected 2, got 3'] },
          { fullName: 'skipped test', status: 'skipped', duration: null },
        ],
      }],
    });
    const result = parseJestStyleResults(json);
    assert.equal(result.tests.length, 3);
    assert.equal(result.tests[0].status, 'pass');
    assert.equal(result.tests[1].status, 'fail');
    assert.equal(result.tests[1].failureMessage, 'Expected 2, got 3');
    assert.equal(result.tests[2].status, 'skip');
    assert.equal(result.numPassed, 1);
    assert.equal(result.numFailed, 1);
  });

  await t.test('handles multiple test files in one report', () => {
    const json = JSON.stringify({
      testResults: [
        { assertionResults: [{ fullName: 'test A', status: 'passed' }] },
        { assertionResults: [{ fullName: 'test B', status: 'passed' }] },
      ],
    });
    assert.equal(parseJestStyleResults(json).tests.length, 2);
  });

  await t.test('throws on genuinely invalid JSON, rather than silently returning empty results', () => {
    assert.throws(() => parseJestStyleResults('{ not valid json'));
  });

  await t.test('handles a report with zero test results gracefully', () => {
    const result = parseJestStyleResults(JSON.stringify({ testResults: [] }));
    assert.deepEqual(result.tests, []);
  });
});
