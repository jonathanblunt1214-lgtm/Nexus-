const path = require('path');
const { execFile } = require('child_process');
const yaml = require('js-yaml');
const { queryLanguageIntelligence } = require('./languageIntelligence');

const registry = new Map();
const extensionIndex = new Map();

function registerChecker(adapter) {
  if (!adapter?.id || !Array.isArray(adapter.extensions) || typeof adapter.check !== 'function') throw new Error('A checker needs an id, extensions, and check function.');
  const normalized = Object.freeze({ external:false, ...adapter, extensions:adapter.extensions.map((ext) => ext.toLowerCase()) });
  registry.set(normalized.id, normalized);
  for (const extension of normalized.extensions) extensionIndex.set(extension, normalized.id);
  return normalized;
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
  registerChecker({ id, language, extensions, external:true, install, async check({ content, folder, allowExternal }) {
    const structural = structuralDiagnostics(content, language);
    if (structural.length || !allowExternal) return { diagnostics:structural, available:false, restricted:!allowExternal, install };
    const result = await runExternal(command, args, content, folder);
    return { diagnostics:result.passed ? [] : diagnosticsFromTool(result.output, language), available:result.available, install };
  } });
}

registerChecker({ id:'typescript', language:'JavaScript / TypeScript', extensions:['.js','.jsx','.mjs','.cjs','.ts','.tsx','.mts','.cts'], async check(input) { return queryLanguageIntelligence({ ...input, action:'diagnostics' }); } });
registerChecker({ id:'json', language:'JSON', extensions:['.json','.jsonc'], async check({ content, filePath }) { try { JSON.parse(path.extname(filePath).toLowerCase() === '.jsonc' ? content.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1') : content); return { diagnostics:[] }; } catch (error) { const position = Number(error.message.match(/position (\d+)/)?.[1] || 0); const before = content.slice(0, position); return { diagnostics:[diagnostic(error.message, { line:before.split('\n').length - 1, column:position - (before.lastIndexOf('\n') + 1), source:'JSON' })] }; } } });
registerChecker({ id:'yaml', language:'YAML', extensions:['.yml','.yaml'], async check({ content }) { try { yaml.load(content); return { diagnostics:[] }; } catch (error) { return { diagnostics:[diagnostic(error.reason || error.message, { line:error.mark?.line, column:error.mark?.column, source:'YAML' })] }; } } });
registerChecker({ id:'markup', language:'HTML / XML / Vue / Svelte', extensions:['.html','.htm','.xml','.vue','.svelte'], async check({ content, filePath }) { return { diagnostics:markupDiagnostics(content, path.extname(filePath).slice(1).toUpperCase(), /\.html?$/.test(filePath)) }; } });
registerChecker({ id:'styles', language:'CSS / Sass / Less', extensions:['.css','.scss','.sass','.less'], async check({ content }) { return { diagnostics:structuralDiagnostics(content, 'Stylesheet') }; } });
registerChecker({ id:'text-structure', language:'Structured text', extensions:['.md','.mdx','.sql','.graphql','.toml'], async check({ content }) { return { diagnostics:structuralDiagnostics(content, 'Structure') }; } });
externalAdapter({ id:'python', language:'Python', extensions:['.py'], command:'python', args:['-c','import ast,sys; ast.parse(sys.stdin.read())'], install:'Install Python and ensure python is on PATH.' });
externalAdapter({ id:'ruby', language:'Ruby', extensions:['.rb'], command:'ruby', args:['-c','-'], install:'Install Ruby and ensure ruby is on PATH.' });
externalAdapter({ id:'go', language:'Go', extensions:['.go'], command:'gofmt', args:[], install:'Install Go; Nexus uses gofmt syntax validation.' });
externalAdapter({ id:'rust', language:'Rust', extensions:['.rs'], command:'rustc', args:['--crate-type','lib','--emit','metadata','-o',path.join(require('os').tmpdir(),'nexus-check.rmeta'),'-'], install:'Install Rust and ensure rustc is on PATH.' });
externalAdapter({ id:'java', language:'Java / Kotlin / Scala', extensions:['.java','.kt','.kts','.scala'], command:'java', args:['-version'], install:'Install the project language toolchain; structural checks remain available.' });
externalAdapter({ id:'c', language:'C', extensions:['.c','.h'], command:'clang', args:['-fsyntax-only','-x','c','-'], install:'Install Clang and ensure clang is on PATH.' });
externalAdapter({ id:'cpp', language:'C++', extensions:['.cpp','.cc','.hpp'], command:'clang++', args:['-fsyntax-only','-x','c++','-'], install:'Install Clang and ensure clang++ is on PATH.' });
externalAdapter({ id:'csharp', language:'C#', extensions:['.cs'], command:'dotnet', args:['--info'], install:'Install the .NET SDK; project build diagnostics provide full C# checking.' });
externalAdapter({ id:'php', language:'PHP', extensions:['.php'], command:'php', args:['-l'], install:'Install PHP and ensure php is on PATH.' });
externalAdapter({ id:'shell', language:'Shell', extensions:['.sh','.bash'], command:'bash', args:['-n'], install:'Install Bash or use WSL.' });
externalAdapter({ id:'powershell', language:'PowerShell / Batch', extensions:['.ps1','.bat'], command:'pwsh', args:['-NoProfile','-NonInteractive','-Command','$text=[Console]::In.ReadToEnd();$e=$null;$t=$null;[Management.Automation.Language.Parser]::ParseInput($text,[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|%{"$($_.Extent.StartLineNumber):$($_.Extent.StartColumnNumber): $($_.Message)"};exit 1}'], install:'Install PowerShell 7 for PowerShell diagnostics.' });
externalAdapter({ id:'swift', language:'Swift', extensions:['.swift'], command:'swiftc', args:['-parse','-'], install:'Install the Swift toolchain.' });
externalAdapter({ id:'dart', language:'Dart', extensions:['.dart'], command:'dart', args:['--version'], install:'Install the Dart SDK; project analysis provides full diagnostics.' });
externalAdapter({ id:'lua', language:'Lua', extensions:['.lua'], command:'lua', args:['-e','assert(load(io.read("*a")))'], install:'Install Lua and ensure lua is on PATH.' });
externalAdapter({ id:'beam', language:'Elixir / Erlang', extensions:['.ex','.exs'], command:'elixir', args:['--version'], install:'Install Elixir; project compilation provides full diagnostics.' });
externalAdapter({ id:'r', language:'R', extensions:['.r'], command:'Rscript', args:['-e','parse(file("stdin"))'], install:'Install R and ensure Rscript is on PATH.' });
externalAdapter({ id:'elm', language:'Elm', extensions:['.elm'], command:'elm', args:['--version'], install:'Install Elm; elm make provides full project diagnostics.' });
externalAdapter({ id:'perl', language:'Perl', extensions:['.pl'], command:'perl', args:['-c'], install:'Install Perl and ensure perl is on PATH.' });

async function checkCode({ folder, filePath, content, allowExternal = false }) {
  const extension = path.extname(filePath || '').toLowerCase(); const id = extensionIndex.get(extension); const adapter = id && registry.get(id);
  if (!adapter) return { ok:true, recognized:false, language:extension || 'Plain text', checker:null, diagnostics:[], available:false, message:'No checker adapter is registered for this file type yet.' };
  try {
    const result = await adapter.check({ folder, filePath, content:String(content ?? ''), allowExternal });
    return { ok:true, recognized:true, language:adapter.language, checker:adapter.id, external:adapter.external, available:result.available !== false, restricted:Boolean(result.restricted), install:result.install || null, diagnostics:(result.diagnostics || []).slice(0, 200) };
  } catch (error) { return { ok:false, recognized:true, language:adapter.language, checker:adapter.id, diagnostics:[diagnostic(error.message, { source:adapter.language })], error:error.message }; }
}

function checkerCatalog() { return [...registry.values()].map(({ check, ...adapter }) => adapter); }
module.exports = { registerChecker, checkCode, checkerCatalog, structuralDiagnostics, markupDiagnostics };
