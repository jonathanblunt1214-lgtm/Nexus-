const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PROVIDERS = Object.freeze({
  python:{ id:'pyright', name:'Microsoft Pyright', license:'MIT', bundled:true, languageId:'python', extensions:['.py'] },
  java:{ id:'jdtls', name:'Eclipse JDT LS', license:'EPL-2.0', bundled:false, languageId:'java', extensions:['.java'] },
  csharp:{ id:'roslyn', name:'Microsoft Roslyn Language Server', license:'MIT', bundled:false, languageId:'csharp', extensions:['.cs'] },
  clang:{ id:'clangd', name:'LLVM clangd', license:'Apache-2.0 WITH LLVM-exception', bundled:false, languageId:'cpp', extensions:['.c','.h','.cpp','.cc','.hpp','.m','.mm'] },
  powershell:{ id:'powershell-editor-services', name:'PowerShell Editor Services', license:'MIT', bundled:false, languageId:'powershell', extensions:['.ps1'] },
  dart:{ id:'dart-language-server', name:'Dart Analysis Server', license:'BSD-3-Clause', bundled:false, languageId:'dart', extensions:['.dart'] },
  swift:{ id:'sourcekit-lsp', name:'Swift SourceKit-LSP', license:'Apache-2.0', bundled:false, languageId:'swift', extensions:['.swift'] },
});

let configuredPaths = {};
function configureOfficialLanguageServices(paths = {}) { configuredPaths = { ...paths }; }
function fileUri(filePath) { return `file:///${path.resolve(filePath).replace(/\\/g, '/')}`; }
function providerFor(filePath) { const ext = path.extname(filePath || '').toLowerCase(); const provider = Object.values(PROVIDERS).find((item) => item.extensions.includes(ext)) || null; if (provider?.id !== 'clangd') return provider; const languageId = ext === '.m' ? 'objective-c' : ext === '.mm' ? 'objective-cpp' : ext === '.c' || ext === '.h' ? 'c' : 'cpp'; return { ...provider, languageId }; }
function serviceData(folder, name) { const id = crypto.createHash('sha256').update(path.resolve(folder)).digest('hex').slice(0, 16); const target = path.join(os.tmpdir(), 'nexus-language-services', id, name); fs.mkdirSync(target, { recursive:true }); return target; }

function launchFor(provider, folder) {
  if (provider.id === 'pyright') {
    const script = path.join(path.dirname(require.resolve('pyright/package.json')), 'langserver.index.js');
    return { command:process.execPath, args:[script, '--stdio'], env:{ ...process.env, ELECTRON_RUN_AS_NODE:'1' } };
  }
  if (provider.id === 'jdtls') { const server = configuredPaths.jdtls || 'jdtls'; return path.extname(server).toLowerCase() === '.py' ? { command:configuredPaths.python || 'python', args:[server, '-data', serviceData(folder, 'jdtls-workspace')] } : { command:server, args:['-data', serviceData(folder, 'jdtls-workspace')] }; }
  if (provider.id === 'clangd') return { command:configuredPaths.clangd || 'clangd', args:['--background-index=false','--clang-tidy'] };
  if (provider.id === 'roslyn') {
    const server = configuredPaths.roslyn || process.env.NEXUS_ROSLYN_SERVER || 'Microsoft.CodeAnalysis.LanguageServer';
    return path.extname(server).toLowerCase() === '.dll'
      ? { command:configuredPaths.dotnet || 'dotnet', args:['exec', server, '--logLevel','Warning','--extensionLogDirectory',serviceData(folder,'roslyn-logs'),'--stdio'] }
      : { command:server, args:['--logLevel','Warning','--extensionLogDirectory',serviceData(folder,'roslyn-logs'),'--stdio'] };
  }
  if (provider.id === 'powershell-editor-services') {
    const script = configuredPaths.powershellEditorServices || process.env.NEXUS_PSES_PATH;
    if (!script) return null;
    return { command:configuredPaths.pwsh || 'pwsh', args:['-NoLogo','-NoProfile','-File',script,'-Stdio','-HostName','Nexus','-HostProfileId','nexus','-HostVersion','1.1.0'] };
  }
  if (provider.id === 'dart-language-server') return { command:configuredPaths.dart || 'dart', args:['language-server','--protocol=lsp'] };
  if (provider.id === 'sourcekit-lsp') return { command:configuredPaths.sourcekitLsp || 'sourcekit-lsp', args:[] };
  return null;
}

function applyTextEdits(content, edits) {
  const offsets = [0]; for (let index = 0; index < content.length; index += 1) if (content[index] === '\n') offsets.push(index + 1);
  const offset = (position) => Math.min(content.length, (offsets[position.line] ?? content.length) + position.character);
  const normalized = (edits || []).map((edit) => ({ start:offset(edit.range.start), end:offset(edit.range.end), text:edit.newText })).sort((a, b) => b.start - a.start);
  for (let index = 1; index < normalized.length; index += 1) if (normalized[index - 1].start < normalized[index].end) return content;
  return normalized.reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), content);
}

function normalizedDiagnostics(items, provider) {
  return (items || []).slice(0, 200).map((item) => ({ line:item.range?.start?.line || 0, column:item.range?.start?.character || 0, length:Math.max(1, (item.range?.end?.character || 1) - (item.range?.start?.character || 0)), severity:item.severity === 1 ? 'error' : 'warning', message:String(item.message || ''), code:String(item.code || 'language-service'), source:provider.name }));
}

async function runLanguageServer({ folder, filePath, content, fix = false }) {
  const provider = providerFor(filePath); if (!provider) return { ok:true, available:false, reason:'No first-party language server is registered.' };
  const launch = launchFor(provider, folder); if (!launch) return { ok:true, available:false, provider, reason:`Configure the local ${provider.name} path in Nexus Settings.` };
  return new Promise((resolve) => {
    let child; try { child = spawn(launch.command, launch.args, { cwd:folder, env:launch.env || process.env, windowsHide:true, stdio:['pipe','pipe','pipe'] }); } catch (error) { resolve({ ok:true, available:false, provider, reason:error.message }); return; }
    let buffer = Buffer.alloc(0); let id = 0; const pending = new Map(); let diagnostics = []; let settled = false;
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(overall); for (const waiter of pending.values()) clearTimeout(waiter.timer); pending.clear(); try { child.kill(); } catch {} resolve(result); };
    const send = (message) => { const body = Buffer.from(JSON.stringify({ jsonrpc:'2.0', ...message })); child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); child.stdin.write(body); };
    const request = (method, params) => new Promise((res, rej) => { const requestId = ++id; const timer = setTimeout(() => { if (pending.delete(requestId)) rej(new Error(`${provider.name} timed out during ${method}.`)); }, 10000); pending.set(requestId, { res, rej, timer }); send({ id:requestId, method, params }); });
    const respond = (requestId, result = null) => send({ id:requestId, result });
    const processMessage = (message) => {
      if (message.id != null && !message.method) { const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); message.error ? waiter.rej(new Error(message.error.message)) : waiter.res(message.result); } return; }
      if (message.method === 'textDocument/publishDiagnostics') diagnostics = message.params?.diagnostics || [];
      if (message.id != null) respond(message.id, message.method === 'workspace/configuration' ? [] : null);
    };
    child.stdout.on('data', (chunk) => { buffer = Buffer.concat([buffer, chunk]); while (true) { const marker = buffer.indexOf('\r\n\r\n'); if (marker < 0) break; const header = buffer.slice(0, marker).toString(); const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]); if (!Number.isFinite(length) || buffer.length < marker + 4 + length) break; const body = buffer.slice(marker + 4, marker + 4 + length); buffer = buffer.slice(marker + 4 + length); try { processMessage(JSON.parse(body.toString())); } catch {} } });
    child.on('error', (error) => finish({ ok:true, available:false, provider, reason:error.code === 'ENOENT' ? `${provider.name} is not installed or its path is not configured.` : error.message }));
    child.on('exit', (code) => { if (!settled) finish({ ok:true, available:false, provider, reason:`${provider.name} exited before completing (code ${code}).` }); });
    const overall = setTimeout(() => finish({ ok:true, available:false, provider, reason:`${provider.name} did not respond within 20 seconds.` }), 20000);
    (async () => {
      try {
        const uri = fileUri(filePath); const rootUri = fileUri(folder);
        await request('initialize', { processId:process.pid, rootUri, capabilities:{ workspace:{ configuration:true }, textDocument:{ publishDiagnostics:{}, codeAction:{ codeActionLiteralSupport:{ codeActionKind:{ valueSet:['quickfix','source.fixAll'] } } } } }, workspaceFolders:[{ uri:rootUri, name:path.basename(folder) }] });
        send({ method:'initialized', params:{} }); send({ method:'textDocument/didOpen', params:{ textDocument:{ uri, languageId:provider.languageId, version:1, text:content } } });
        await new Promise((res) => setTimeout(res, provider.id === 'jdtls' ? 3500 : 1500));
        if (!fix) return finish({ ok:true, available:true, provider, diagnostics:normalizedDiagnostics(diagnostics, provider) });
        const endLines = content.split(/\r?\n/); const range = { start:{ line:0, character:0 }, end:{ line:endLines.length - 1, character:endLines.at(-1).length } };
        const actions = await request('textDocument/codeAction', { textDocument:{ uri }, range, context:{ diagnostics, only:['quickfix','source.fixAll'] } });
        const edits = (actions || []).flatMap((action) => action.edit?.changes?.[uri] || action.edit?.documentChanges?.flatMap((change) => change.edits || []) || []);
        const correctedContent = applyTextEdits(content, edits);
        finish({ ok:true, available:true, provider, correctedContent, fixesApplied:correctedContent === content ? 0 : edits.length, source:provider.name, diagnostics:normalizedDiagnostics(diagnostics, provider) });
      } catch (error) { finish({ ok:true, available:false, provider, reason:error.message }); }
    })();
  });
}

async function languageServerStatus() {
  const keys = { 'powershell-editor-services':'powershellEditorServices', 'dart-language-server':'dart', 'sourcekit-lsp':'sourcekitLsp' };
  return Object.values(PROVIDERS).map((provider) => ({ ...provider, configured:provider.bundled || Boolean(configuredPaths[keys[provider.id] || provider.id]) }));
}

module.exports = { PROVIDERS, configureOfficialLanguageServices, providerFor, runLanguageServer, languageServerStatus, applyTextEdits };
