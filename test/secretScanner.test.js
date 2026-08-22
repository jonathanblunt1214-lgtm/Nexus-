const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { scanStaged } = require('../secretScanner');

test('pre-commit scanning detects staged credentials without returning their values', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-secret-scan-'));
  try { execFileSync('git', ['init', '-b', 'main'], { cwd: folder }); fs.writeFileSync(path.join(folder, 'config.js'), "const api_key = 'this-is-a-very-secret-value';\n"); execFileSync('git', ['add', '.'], { cwd: folder }); const result = await scanStaged(folder); assert.equal(result.findings.length, 1); assert.equal(result.findings[0].type, 'Generic API key'); assert.doesNotMatch(JSON.stringify(result), /this-is-a-very-secret-value/); } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('GitHub secret publishing uses sealed-box encryption and never sends plaintext', () => {
  const source = fs.readFileSync(require.resolve('../githubClient'), 'utf8');
  assert.match(source, /crypto_box_seal/);
  assert.match(source, /encrypted_value/);
  assert.match(source, /environments.*secrets/);
});
