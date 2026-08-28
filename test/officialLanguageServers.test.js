const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PROVIDERS, runLanguageServer, applyTextEdits, fileUri } = require('../officialLanguageServers');

test('licensed first-party language server registry covers the requested providers', () => {
  assert.deepEqual(Object.values(PROVIDERS).map((item) => item.id), ['pyright','jdtls','roslyn','clangd','powershell-editor-services','dart-language-server','sourcekit-lsp']);
  assert.equal(PROVIDERS.python.bundled, true);
  for (const provider of Object.values(PROVIDERS)) assert.ok(provider.license && provider.name && provider.extensions.length);

  // Nexus only distributes bundled language-server code. Verify that bundled
  // providers declare the same license as the installed package metadata;
  // non-bundled providers remain user-installed external tools.
  for (const provider of Object.values(PROVIDERS).filter((item) => item.bundled)) {
    if (provider.id === 'pyright') {
      const metadata = require('pyright/package.json');
      assert.equal(metadata.license, provider.license);
    }
  }
});

test('bundled Pyright returns real Microsoft diagnostics for in-memory Python', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pyright-')); t.after(() => fs.rmSync(folder, { recursive:true, force:true }));
  const result = await runLanguageServer({ folder, filePath:path.join(folder, 'sample.py'), content:'value: str = 1\n' });
  assert.equal(result.available, true);
  assert.equal(result.provider.id, 'pyright');
  assert.ok(result.diagnostics.some((item) => item.severity === 'error' && item.source === 'Microsoft Pyright'));
});

test('bundled Pyright has a bounded cold-start allowance for slower Windows runners', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'officialLanguageServers.js'), 'utf8');
  assert.match(source, /provider\.id === 'pyright' \? 20000/);
  assert.match(source, /did not respond within 30 seconds[\s\S]*30000/);
});

test('language-server edits are applied deterministically without executing code', () => {
  const content = 'alpha beta';
  const updated = applyTextEdits(content, [{ range:{ start:{ line:0, character:6 }, end:{ line:0, character:10 } }, newText:'gamma' }]);
  assert.equal(updated, 'alpha gamma');
});

test('language-server file URIs are valid on both Windows and POSIX paths', () => {
  const uri = fileUri(path.join(os.tmpdir(), 'nexus uri test', 'sample.py'));
  assert.match(uri, /^file:\/\/\//);
  assert.doesNotMatch(uri, /^file:\/\/\/\//);
  assert.match(uri, /nexus%20uri%20test/);
});

test('Settings exposes narrow local service selection and license status', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'); const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8'); const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const channel of ['language-services:status','language-services:choose','language-services:clear']) { assert.ok(main.includes(channel)); assert.ok(preload.includes(channel.split(':')[1]) || preload.includes('languageServices')); }
  assert.match(main, /start-editorservices\.ps1/i); assert.match(main, /Roslyn executable or DLL/); assert.match(html, /Official Local Language Services/); assert.match(html, /Project code stays on this computer/);
});
