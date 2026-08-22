const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage']);

function inside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(base + path.sep) ? target : null;
}

function collectSources(root, current = root, result = []) {
  if (result.length >= 2000) return result;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) collectSources(root, full, result);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(full);
    if (result.length >= 2000) break;
  }
  return result;
}

function createService(folder, activeFile, activeContent) {
  const root = path.resolve(folder);
  const file = inside(root, activeFile);
  if (!file || !SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())) throw new Error('Language intelligence supports JavaScript and TypeScript files inside the workspace.');
  const files = collectSources(root);
  if (!files.includes(file)) files.push(file);
  const versions = new Map(files.map((name) => [name, '0']));
  const options = {
    allowJs: true, checkJs: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowSyntheticDefaultImports: true, esModuleInterop: true, skipLibCheck: true,
  };
  const host = {
    getScriptFileNames: () => files,
    getScriptVersion: (name) => versions.get(name) || '0',
    getScriptSnapshot: (name) => {
      if (path.resolve(name) === file && typeof activeContent === 'string') return ts.ScriptSnapshot.fromString(activeContent);
      try { return ts.ScriptSnapshot.fromString(fs.readFileSync(name, 'utf8')); } catch { return undefined; }
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  return { service: ts.createLanguageService(host), file, root };
}

function offsetFor(content, line, column) {
  const source = ts.createSourceFile('position.ts', content, ts.ScriptTarget.Latest, false);
  return source.getPositionOfLineAndCharacter(Math.max(0, line || 0), Math.max(0, column || 0));
}

function location(root, fileName, span) {
  const content = fs.readFileSync(fileName, 'utf8');
  const source = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, false);
  const start = source.getLineAndCharacterOfPosition(span.start);
  return { file: path.relative(root, fileName).replace(/\\/g, '/'), line: start.line, column: start.character, length: span.length };
}

function textParts(parts) { return ts.displayPartsToString(parts || []); }

function queryLanguageIntelligence({ folder, filePath, content, line, column, action, newName }) {
  const { service, file, root } = createService(folder, filePath, content);
  const offset = offsetFor(content, line, column);
  if (action === 'complete') {
    const result = service.getCompletionsAtPosition(file, offset, { includeCompletionsForModuleExports: true, includeInsertTextCompletions: true });
    return { ok: true, items: (result?.entries || []).slice(0, 100).map((entry) => {
      let importEdits = [];
      if (entry.source) {
        const details = service.getCompletionEntryDetails(file, offset, entry.name, {}, entry.source, {}, entry.data);
        importEdits = (details?.codeActions || []).flatMap((actionItem) => actionItem.changes || [])
          .filter((change) => path.resolve(change.fileName) === file)
          .flatMap((change) => change.textChanges.map((edit) => ({ start: edit.span.start, length: edit.span.length, newText: edit.newText })));
      }
      return { name: entry.name, kind: entry.kind, source: entry.source || null, sortText: entry.sortText, importEdits };
    }) };
  }
  if (action === 'definition') return { ok: true, locations: (service.getDefinitionAtPosition(file, offset) || []).map((entry) => location(root, entry.fileName, entry.textSpan)) };
  if (action === 'references') return { ok: true, locations: (service.getReferencesAtPosition(file, offset) || []).map((entry) => location(root, entry.fileName, entry.textSpan)) };
  if (action === 'hover') {
    const info = service.getQuickInfoAtPosition(file, offset);
    return { ok: true, hover: info ? { signature: textParts(info.displayParts), documentation: textParts(info.documentation), kind: info.kind } : null };
  }
  if (action === 'diagnostics') {
    const diagnostics = [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)];
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false);
    return { ok: true, diagnostics: diagnostics.slice(0, 200).map((item) => {
      const start = source.getLineAndCharacterOfPosition(item.start || 0);
      return { line: start.line, column: start.character, length: item.length || 1, severity: item.category === ts.DiagnosticCategory.Error ? 'error' : 'warning', message: ts.flattenDiagnosticMessageText(item.messageText, '\n'), code: item.code };
    }) };
  }
  if (action === 'symbols') {
    const tree = service.getNavigationTree(file);
    const flatten = (node, depth = 0) => [
      ...(node.text === '<global>' ? [] : [{ name: node.text, kind: node.kind, depth, ...location(root, file, node.spans[0]) }]),
      ...(node.childItems || []).flatMap((child) => flatten(child, depth + 1)),
    ];
    return { ok: true, symbols: tree ? flatten(tree).slice(0, 500) : [] };
  }
  if (action === 'rename') {
    if (!newName || !/^[A-Za-z_$][\w$]*$/.test(newName)) return { ok: false, error: 'Enter a valid JavaScript/TypeScript identifier.' };
    const locations = service.findRenameLocations(file, offset, false, false, true) || [];
    const grouped = new Map();
    for (const item of locations) {
      const target = inside(root, item.fileName);
      if (!target) continue;
      if (!grouped.has(target)) grouped.set(target, []);
      grouped.get(target).push(item.textSpan);
    }
    const files = [];
    for (const [target, spans] of grouped) {
      let updated = target === file ? content : fs.readFileSync(target, 'utf8');
      for (const span of spans.sort((a, b) => b.start - a.start)) updated = updated.slice(0, span.start) + newName + updated.slice(span.start + span.length);
      files.push({ filePath: target, relPath: path.relative(root, target).replace(/\\/g, '/'), content: updated, edits: spans.length });
    }
    return { ok: true, files };
  }
  return { ok: false, error: `Unknown language action: ${action}` };
}

module.exports = { queryLanguageIntelligence, offsetFor, inside };
