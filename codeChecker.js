const path = require('path');
const { execFile } = require('child_process');
const yaml = require('js-yaml');
const { queryLanguageIntelligence } = require('./languageIntelligence');
const webServices = require('./webLanguageServices');
const officialServers = require('./officialLanguageServers');

const registry = new Map();
const extensionIndex = new Map();

function checkerKey(filePath) {
  return path.basename(filePath || '').toLowerCase() === 'dockerfile' ? 'dockerfile' : path.extname(filePath || '').toLowerCase();
}

function registerChecker(adapter) {
  if (!adapter?.id || !Array.isArray(adapter.extensions) || typeof adapter.check !== 'function') throw new Error('A checker needs an id, extensions, and check function.');
  const normalized = Object.freeze({ external:false, fix:genericStructuralFix, ...adapter, extensions:adapter.extensions.map((ext) => ext.toLowerCase()) });
  registry.set(normalized.id, normalized);
  for (const extension of normalized.extensions) extensionIndex.set(extension, normalized.id);
  return normalized;
}

function genericStructuralFix({ content, language = 'Code' }) {
  const pairs = { '(' : ')', '[' : ']', '{' : '}' }; const closing = new Set(Object.values(pairs)); const stack = [];
  let quote = null; let escaped = false;
  for (const char of String(content ?? '')) {
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (pairs[char]) stack.push(char);
    else if (closing.has(char)) {
      if (!stack.length || pairs[stack.at(-1)] !== char) return { ok:true, correctedContent:content, fixesApplied:0, source:`${language} deterministic fix database` };
      stack.pop();
    }
  }
  const suffix = `${quote || ''}${stack.reverse().map((char) => pairs[char]).join('')}`;
  return { ok:true, correctedContent:`${content}${suffix}`, fixesApplied:suffix.length ? 1 : 0, source:`${language} deterministic fix database` };
}

function markupFix({ content, filePath }) {
  let correctedContent = String(content ?? '');
  const html = /\.html?$/i.test(filePath); const voids = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const stack = []; const replacements = []; const pattern = /<!--[\s\S]*?-->|<\/?([A-Za-z][\w:.-]*)(?:\s[^<>]*?)?\s*\/?>/g; let match;
  while ((match = pattern.exec(correctedContent))) {
    if (!match[1]) continue; const tag = match[1].toLowerCase(); const closes = match[0].startsWith('</'); const self = match[0].endsWith('/>') || (html && voids.has(tag));
    if (closes) { const expected = stack.pop(); if (expected && expected !== tag) replacements.push({ start:match.index, length:match[0].length, text:`</${expected}>` }); }
    else if (!self) stack.push(tag);
  }
  for (const item of replacements.sort((a, b) => b.start - a.start)) correctedContent = correctedContent.slice(0, item.start) + item.text + correctedContent.slice(item.start + item.length);
  if (stack.length) correctedContent += stack.reverse().map((tag) => `</${tag}>`).join('');
  const structural = genericStructuralFix({ content:correctedContent, language:'Markup' });
  return { ...structural, fixesApplied:(replacements.length || stack.length || structural.fixesApplied) ? 1 : 0, source:'Markup deterministic fix database' };
}

function jsonFix({ content }) {
  let correctedContent = String(content ?? '').replace(/,\s*([}\]])/g, '$1');
  const structural = genericStructuralFix({ content:correctedContent, language:'JSON' });
  correctedContent = structural.correctedContent;
  return { ok:true, correctedContent, fixesApplied:correctedContent === content ? 0 : 1, source:'JSON deterministic fix database' };
}

function yamlFix({ content }) {
  const correctedContent = String(content ?? '').replace(/^\t+/gm, (tabs) => '  '.repeat(tabs.length)).replace(/[ \t]+$/gm, '');
  return { ok:true, correctedContent, fixesApplied:correctedContent === content ? 0 : 1, source:'YAML deterministic fix database' };
}

function diagnostic(message, { line = 0, column = 0, severity = 'error', code = 'syntax', source = 'Nexus' } = {}) {
  return { line:Math.max(0, Number(line) || 0), column:Math.max(0, Number(column) || 0), length:1, severity, message:String(message), code:String(code), source };
}

function structuralDiagnostics(content, source) {
  const pairs = { ')':'(', ']':'[', '}':'{' }; const open = new Set(Object.values(pairs)); const stack = [];
  let quote = null; let escaped = false; let line = 0; let column = 0;
  for (const char of content) {
    if (char === '\n') { line += 1; column = 0; continue; }
    column += 1;
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (open.has(char)) stack.push({ char, line, column:column - 1 });
    else if (pairs[char]) { const expected = pairs[char]; const actual = stack.pop(); if (!actual || actual.char !== expected) return [diagnostic(`Unexpected ${char}; expected a matching ${expected}.`, { line, column:column - 1, source })]; }
  }
  if (quote) return [diagnostic(`Unclosed ${quote} string.`, { line, column, source })];
  if (stack.length) { const item = stack.at(-1); return [diagnostic(`Unclosed ${item.char}.`, { ...item, source })]; }
  return [];
}

function markupDiagnostics(content, source, html = false) {
  const structural = structuralDiagnostics(content, source); if (structural.length) return structural;
  const voids = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const stack = []; const pattern = /<!--[\s\S]*?-->|<\/?([A-Za-z][\w:.-]*)(?:\s[^<>]*?)?\s*\/?>/g; let match;
  while ((match = pattern.exec(content))) {
    if (!match[1]) continue; const tag = match[1].toLowerCase(); const closing = match[0].startsWith('</'); const selfClosing = match[0].endsWith('/>') || (html && voids.has(tag));
    if (closing) { const current = stack.pop(); if (current?.tag !== tag) { const before = content.slice(0, match.index); return [diagnostic(`Closing </${tag}> does not match ${current ? `<${current.tag}>` : 'an open element'}.`, { line:before.split('\n').length - 1, column:match.index - (before.lastIndexOf('\n') + 1), source })]; } }
    else if (!selfClosing) stack.push({ tag, index:match.index });
  }
  if (stack.length) { const item = stack.at(-1); const before = content.slice(0, item.index); return [diagnostic(`Unclosed <${item.tag}> element.`, { line:before.split('\n').length - 1, column:item.index - (before.lastIndexOf('\n') + 1), source })]; }
  return [];
}

function runExternal(command, args, content, cwd) {
  return new Promise((resolve) => {
    const child = execFile(command, args, { cwd, windowsHide:true, timeout:15000, maxBuffer:2 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      if (error?.code === 'ENOENT') return resolve({ available:false, output:'' });
      resolve({ available:true, passed:!error, output, error });
    });
    child.stdin?.end(content);
  });
}

function diagnosticsFromTool(output, source) {
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean).slice(0, 200).map((text) => {
    const location = text.match(/(?::|\()(?<line>\d+)(?::|,)(?<column>\d+)\)?/);
    return diagnostic(text.slice(0, 1000), { line:Math.max(0, Number(location?.groups?.line || 1) - 1), column:Math.max(0, Number(location?.groups?.column || 1) - 1), source, code:'compiler' });
  });
}

function externalAdapter({ id, language, extensions, command, args, install }) {
  registerChecker({ id, language, extensions, external:true, install, fix:(input) => genericStructuralFix({ ...input, language }), async check({ content, folder, allowExternal }) {
    const structural = structuralDiagnostics(content, language);
    if (structural.length) return { diagnostics:structural, available:true, install };
    if (!allowExternal) return { diagnostics:[], available:false, restricted:true, install };
    const result = await runExternal(command, args, content, folder);
    return { diagnostics:result.passed ? [] : diagnosticsFromTool(result.output, language), available:result.available, install };
  } });
}

function officialServerAdapter({ id, language, extensions, install }) {
  registerChecker({ id, language, extensions, external:true, install,
    async check(input) { if (!input.allowExternal) return { diagnostics:structuralDiagnostics(input.content, language), available:false, restricted:true, install }; return officialServers.runLanguageServer(input); },
    async fix(input) { if (!input.allowExternal) return { ok:true, correctedContent:input.content, fixesApplied:0, source:id }; return officialServers.runLanguageServer({ ...input, fix:true }); },
  });
}

registerChecker({ id:'typescript', language:'JavaScript / TypeScript', extensions:['.js','.jsx','.mjs','.cjs','.ts','.tsx','.mts','.cts'], async check(input) { return queryLanguageIntelligence({ ...input, action:'diagnostics' }); }, async fix(input) { const result = queryLanguageIntelligence({ ...input, action:'fix' }); return result.fixesApplied ? result : genericStructuralFix({ ...input, language:'JavaScript / TypeScript' }); } });
registerChecker({ id:'json', language:'JSON', extensions:['.json','.jsonc'], fix:webServices.jsonFix, check:webServices.jsonCheck });
registerChecker({ id:'yaml', language:'YAML', extensions:['.yml','.yaml'], fix:yamlFix, async check({ content }) { try { yaml.load(content); return { diagnostics:[] }; } catch (error) { return { diagnostics:[diagnostic(error.reason || error.message, { line:error.mark?.line, column:error.mark?.column, source:'YAML' })] }; } } });
registerChecker({ id:'markup', language:'HTML / XML / Vue / Svelte', extensions:['.html','.htm','.xml','.vue','.svelte'], fix:async (input) => /\.html?$/i.test(input.filePath) ? webServices.htmlFix(input) : markupFix(input), async check({ content, filePath }) { return { diagnostics:markupDiagnostics(content, path.extname(filePath).slice(1).toUpperCase(), /\.html?$/.test(filePath)) }; } });
registerChecker({ id:'styles', language:'CSS / Sass / Less', extensions:['.css','.scss','.sass','.less'], fix:webServices.cssFix, check:webServices.cssCheck });
registerChecker({ id:'text-structure', language:'Structured text', extensions:['.md','.mdx','.sql','.graphql','.toml'], async check({ content }) { return { diagnostics:structuralDiagnostics(content, 'Structure') }; } });
registerChecker({ id:'dockerfile', language:'Dockerfile', extensions:['dockerfile'], async check({ content }) { return { diagnostics:structuralDiagnostics(content, 'Dockerfile') }; } });
officialServerAdapter({ id:'python', language:'Python', extensions:['.py'], install:'Microsoft Pyright is bundled with Nexus.' });
externalAdapter({ id:'ruby', language:'Ruby', extensions:['.rb'], command:'ruby', args:['-c','-'], install:'Install Ruby and ensure ruby is on PATH.' });
externalAdapter({ id:'go', language:'Go', extensions:['.go'], command:'gofmt', args:[], install:'Install Go; Nexus uses gofmt syntax validation.' });
externalAdapter({ id:'rust', language:'Rust', extensions:['.rs'], command:'rustc', args:['--crate-type','lib','--emit','metadata','-o',path.join(require('os').tmpdir(),'nexus-check.rmeta'),'-'], install:'Install Rust and ensure rustc is on PATH.' });
officialServerAdapter({ id:'java', language:'Java', extensions:['.java'], install:'Install Eclipse JDT LS and configure its executable in Nexus Settings.' });
externalAdapter({ id:'jvm-other', language:'Kotlin / Scala', extensions:['.kt','.kts','.scala'], command:'java', args:['-version'], install:'Install the project language toolchain; structural checks remain available.' });
officialServerAdapter({ id:'c', language:'C', extensions:['.c','.h'], install:'Install LLVM clangd or configure its executable in Nexus Settings.' });
officialServerAdapter({ id:'cpp', language:'C++', extensions:['.cpp','.cc','.hpp'], install:'Install LLVM clangd or configure its executable in Nexus Settings.' });
officialServerAdapter({ id:'csharp', language:'C#', extensions:['.cs'], install:'Install Roslyn Language Server and configure its executable in Nexus Settings.' });
externalAdapter({ id:'php', language:'PHP', extensions:['.php'], command:'php', args:['-l'], install:'Install PHP and ensure php is on PATH.' });
externalAdapter({ id:'shell', language:'Shell', extensions:['.sh','.bash'], command:'bash', args:['-n'], install:'Install Bash or use WSL.' });
officialServerAdapter({ id:'powershell', language:'PowerShell', extensions:['.ps1'], install:'Install PowerShell Editor Services and configure Start-EditorServices.ps1 in Nexus Settings.' });
externalAdapter({ id:'batch', language:'Windows Batch', extensions:['.bat'], command:'cmd', args:['/d','/q','/c','exit /b 0'], install:'Windows Batch has no first-party language server; Nexus uses non-executing structural checks.' });
externalAdapter({ id:'swift', language:'Swift', extensions:['.swift'], command:'swiftc', args:['-parse','-'], install:'Install the Swift toolchain.' });
externalAdapter({ id:'dart', language:'Dart', extensions:['.dart'], command:'dart', args:['--version'], install:'Install the Dart SDK; project analysis provides full diagnostics.' });
externalAdapter({ id:'lua', language:'Lua', extensions:['.lua'], command:'lua', args:['-e','assert(load(io.read("*a")))'], install:'Install Lua and ensure lua is on PATH.' });
externalAdapter({ id:'beam', language:'Elixir / Erlang', extensions:['.ex','.exs'], command:'elixir', args:['--version'], install:'Install Elixir; project compilation provides full diagnostics.' });
externalAdapter({ id:'r', language:'R', extensions:['.r'], command:'Rscript', args:['-e','parse(file("stdin"))'], install:'Install R and ensure Rscript is on PATH.' });
externalAdapter({ id:'elm', language:'Elm', extensions:['.elm'], command:'elm', args:['--version'], install:'Install Elm; elm make provides full project diagnostics.' });
externalAdapter({ id:'perl', language:'Perl', extensions:['.pl'], command:'perl', args:['-c'], install:'Install Perl and ensure perl is on PATH.' });

async function checkCode({ folder, filePath, content, allowExternal = false }) {
  const extension = checkerKey(filePath); const id = extensionIndex.get(extension); const adapter = id && registry.get(id);
  if (!adapter) return { ok:true, recognized:false, language:extension || 'Plain text', checker:null, diagnostics:[], available:false, message:'No checker adapter is registered for this file type yet.' };
  try {
    const result = await adapter.check({ folder, filePath, content:String(content ?? ''), allowExternal });
    return { ok:true, recognized:true, language:adapter.language, checker:adapter.id, external:adapter.external, available:result.available !== false, restricted:Boolean(result.restricted), install:result.install || null, diagnostics:(result.diagnostics || []).slice(0, 200) };
  } catch (error) { return { ok:false, recognized:true, language:adapter.language, checker:adapter.id, diagnostics:[diagnostic(error.message, { source:adapter.language })], error:error.message }; }
}

function checkerCatalog() { return [...registry.values()].map(({ check, fix, ...adapter }) => ({ ...adapter, correctionAdapter:true })); }
async function proposeCheckerFix({ folder, filePath, content, allowExternal = false }) {
  const extension = checkerKey(filePath); const adapter = registry.get(extensionIndex.get(extension));
  const before = await checkCode({ folder, filePath, content, allowExternal });
  if (!adapter?.fix || !before.available || !before.diagnostics.some((item) => item.severity === 'error')) return { ok:true, available:false, before, reason:'The checker has no deterministic correction for this diagnostic.' };
  const proposal = await adapter.fix({ folder, filePath, content:String(content ?? ''), allowExternal });
  const correctedContent = String(proposal?.correctedContent ?? content);
  if (!proposal?.ok || !proposal.fixesApplied || correctedContent === content) return { ok:true, available:false, before, reason:'The checker did not provide a safe deterministic correction.' };
  const after = await checkCode({ folder, filePath, content:correctedContent, allowExternal });
  if (!after.available || after.diagnostics.some((item) => item.severity === 'error')) return { ok:true, available:false, before, after, reason:'The checker correction did not pass independent rechecking.' };
  return { ok:true, available:true, correctedContent, fixesApplied:proposal.fixesApplied, source:proposal.source || adapter.id, before, after };
}
module.exports = { registerChecker, checkCode, proposeCheckerFix, checkerCatalog, structuralDiagnostics, markupDiagnostics };
