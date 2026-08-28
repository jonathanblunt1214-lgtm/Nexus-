const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function write(rel, text) { fs.writeFileSync(path.join(root, rel), text); }

function sourceFile(text, fileName) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function removeRanges(text, ranges) {
  for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) {
    text = text.slice(0, start) + text.slice(end);
  }
  return text;
}

function removeTopLevelFunctions(text, fileName, predicate) {
  const sf = sourceFile(text, fileName);
  const ranges = [];
  const removedNames = [];
  for (const statement of sf.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
    const name = statement.name.text;
    if (!predicate(name)) continue;
    ranges.push([statement.getFullStart(), statement.end]);
    removedNames.push(name);
  }
  return { text: removeRanges(text, ranges), removedNames };
}

function removeTopLevelIpcHandlers(text, fileName, channels) {
  const sf = sourceFile(text, fileName);
  const ranges = [];
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = statement.expression;
    if (!ts.isCallExpression(expression)) continue;
    const callee = expression.expression;
    if (!ts.isPropertyAccessExpression(callee) || callee.expression.getText(sf) !== 'ipcMain' || callee.name.text !== 'handle') continue;
    const first = expression.arguments[0];
    if (!first || !ts.isStringLiteralLike(first)) continue;
    if (channels.has(first.text)) ranges.push([statement.getFullStart(), statement.end]);
  }
  return removeRanges(text, ranges);
}

function removeTopLevelCallsTo(text, fileName, names) {
  const sf = sourceFile(text, fileName);
  const ranges = [];
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const body = statement.getText(sf);
    if ([...names].some((name) => new RegExp(`\\b${name}\\s*\\(`).test(body))) {
      ranges.push([statement.getFullStart(), statement.end]);
    }
  }
  return removeRanges(text, ranges);
}

function removeHtmlCardByLabel(text, prefix) {
  const labelNeedle = `class="label">${prefix}`;
  const labelIndex = text.indexOf(labelNeedle);
  if (labelIndex < 0) return text;
  const start = text.lastIndexOf('<div class="card">', labelIndex);
  if (start < 0) throw new Error(`Could not find card start for ${prefix}`);
  const tag = /<div\b[^>]*>|<\/div>/g;
  tag.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tag.exec(text))) {
    if (match[0].startsWith('</')) depth -= 1;
    else depth += 1;
    if (depth === 0) {
      let end = tag.lastIndex;
      while (end < text.length && /[\r\n]/.test(text[end])) end += 1;
      return text.slice(0, start) + text.slice(end);
    }
  }
  throw new Error(`Could not find card end for ${prefix}`);
}

// main.js: physically remove user-managed Gemini/OpenAI credential IPC and the
// retired Ask OpenAI route. Keep Ask Gemini, but make it consume only the
// Nexus-owned build credential.
let main = read('main.js');
main = removeTopLevelIpcHandlers(main, 'main.js', new Set([
  'save-gemini-key', 'has-gemini-key', 'clear-gemini-key',
  'save-openai-key', 'has-openai-key', 'clear-openai-key', 'openai-ask',
]));
({ text: main } = removeTopLevelFunctions(main, 'main.js', (name) => name === 'getGeminiKey' || name === 'getOpenaiKey'));
const legacyGeminiLookup = "const key = getGeminiKey();\n  if (!key) return { ok: false, error: 'No Gemini API key saved yet.' };";
if (!main.includes(legacyGeminiLookup)) throw new Error('Legacy Gemini key lookup was not found in main.js.');
main = main.replace(legacyGeminiLookup, "const key = String(process.env.NEXUS_GEMINI_API_KEY || '').trim();\n  if (!key) return { ok: false, error: 'Nexus Gemini is not configured in this build.' };");
main = main.replace('// --- Gemini API key: stored encrypted at rest via Electron\'s safeStorage ---\n', '');
write('main.js', main);

// preload.js: remove the credential-management bridge and all OpenAI bridge
// methods. Keep geminiAsk because Ask Gemini remains a Nexus-owned service.
let preload = read('preload.js');
preload = preload.split(/(?<=\n)/).filter((line) => ![
  'saveGeminiKey:', 'hasGeminiKey:', 'clearGeminiKey:',
  'saveOpenaiKey:', 'hasOpenaiKey:', 'clearOpenaiKey:', 'openaiAsk:',
].some((needle) => line.includes(needle))).join('');
write('preload.js', preload);

// renderer.js: all Gemini/OpenAI functions here belong to the old Settings
// cards. Remove those functions and any top-level initialization calls to them.
let renderer = read('renderer.js');
let rendererResult = removeTopLevelFunctions(renderer, 'renderer.js', (name) => /gemini|openai/i.test(name));
renderer = removeTopLevelCallsTo(rendererResult.text, 'renderer.js', new Set(rendererResult.removedNames));
write('renderer.js', renderer);

// index.html: physically delete the retired Settings cards instead of hiding
// them after load.
let html = read('index.html');
for (const prefix of ['Gemini API Key', 'OpenAI API Key', 'Ask Gemini', 'Ask OpenAI']) {
  html = removeHtmlCardByLabel(html, prefix);
}
write('index.html', html);

// bootstrap.js no longer needs runtime suppression for source that no longer
// exists. It still owns provider unification, Firebase project ownership, and
// automatic build numbering.
let bootstrap = read('bootstrap.js');
let bootstrapResult = removeTopLevelFunctions(bootstrap, 'bootstrap.js', (name) => name === 'askWithNexusGemini');
bootstrap = bootstrapResult.text;
bootstrap = bootstrap.split(/(?<=\n)/).filter((line) => ![
  "'gemini-ask',",
  "removeCard('Gemini API Key')",
  "removeCard('Ask Gemini')",
  "removeCard('OpenAI API Key')",
  "removeCard('Ask OpenAI')",
].some((needle) => line.includes(needle))).join('');
bootstrap = bootstrap.replace(/\n    \/\/ Ask Gemini remains an internal Nexus service\.[\s\S]*?\n    if \(channel === 'gemini-ask'\) \{[\s\S]*?\n    \}\n/, '\n');
bootstrap = bootstrap.replace(/\n\/\/ Permanently retire the user-managed Gemini-key and OpenAI surfaces[\s\S]*?ipcMain\.removeHandler\(channel\);\n/, '\n');
write('bootstrap.js', bootstrap);

// Replace the runtime-only regression test with a source-clean regression test.
let testFile = read('test/codingModelProviders.test.js');
const testStart = testFile.indexOf("test('safe provider discovery owns hosted keys and obsolete global settings are absent at runtime'");
if (testStart < 0) throw new Error('Expected provider/settings regression test was not found.');
testFile = testFile.slice(0, testStart) + `test('retired Gemini/OpenAI settings are physically absent from application source', () => {\n  const files = ['main.js', 'preload.js', 'renderer.js', 'index.html', 'bootstrap.js'];\n  const contents = Object.fromEntries(files.map((file) => [file, fs.readFileSync(require.resolve('../' + file), 'utf8')]));\n  const retired = /save-gemini-key|has-gemini-key|clear-gemini-key|save-openai-key|has-openai-key|clear-openai-key|openai-ask|Gemini API Key|OpenAI API Key|Ask OpenAI/;\n  for (const [file, content] of Object.entries(contents)) assert.doesNotMatch(content, retired, file);\n  assert.doesNotMatch(contents['index.html'], /Ask Gemini/);\n  assert.match(contents['main.js'], /NEXUS_GEMINI_API_KEY/);\n  assert.match(contents['main.js'], /gemini-ask/);\n  assert.match(contents['preload.js'], /geminiAsk/);\n});\n`;
write('test/codingModelProviders.test.js', testFile);

// Fail closed if any targeted legacy surface survived the rewrite.
const targets = ['main.js', 'preload.js', 'renderer.js', 'index.html', 'bootstrap.js'];
const forbidden = /save-gemini-key|has-gemini-key|clear-gemini-key|save-openai-key|has-openai-key|clear-openai-key|openai-ask|Gemini API Key|OpenAI API Key|Ask OpenAI/;
for (const file of targets) {
  const content = read(file);
  if (forbidden.test(content)) throw new Error(`Retired AI settings text still exists in ${file}.`);
}
if (/Ask Gemini/.test(read('index.html'))) throw new Error('Ask Gemini still exists in Settings HTML.');

console.log('Retired Gemini/OpenAI Settings source removed successfully.');
