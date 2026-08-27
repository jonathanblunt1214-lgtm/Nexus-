// astEngine.js
// Tree-sitter semantic parsing primitives. This module is intended to run
// inside semanticWorker.js, never on Electron's main event loop.

const fs = require('fs');
const path = require('path');

let initialized = false;
let Parser;
let Language;
const languageCache = new Map();

async function initParserRuntime() {
  if (initialized) return;
  const treeSitter = require('web-tree-sitter');
  Parser = treeSitter.Parser || treeSitter.default || treeSitter;
  Language = treeSitter.Language || Parser.Language;

  // The runtime wasm's filename has changed across web-tree-sitter releases
  // (tree-sitter.wasm pre-0.26, web-tree-sitter.wasm from 0.26 on). Rather
  // than hardcode one name, use whichever file Emscripten actually asks for
  // if it exists next to the resolved package entry point.
  const runtimeDir = path.dirname(require.resolve('web-tree-sitter'));
  await Parser.init({
    locateFile(filename) {
      const candidate = path.join(runtimeDir, filename);
      return fs.existsSync(candidate) ? candidate : filename;
    },
  });
  initialized = true;
}

function grammarPathForExtension(extension) {
  if (extension === '.ts') {
    return require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm');
  }
  if (extension === '.tsx') {
    return require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm');
  }
  if (extension === '.js' || extension === '.jsx' || extension === '.mjs' || extension === '.cjs') {
    return require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm');
  }
  return null;
}

async function getLanguage(extension) {
  if (languageCache.has(extension)) return languageCache.get(extension);
  const grammarPath = grammarPathForExtension(extension);
  if (!grammarPath) return null;
  await initParserRuntime();
  const language = await Language.load(grammarPath);
  languageCache.set(extension, language);
  return language;
}

function firstNamedChildByType(node, types) {
  if (!node) return null;
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (types.has(child.type)) return child;
  }
  return null;
}

function nodeName(node, source) {
  if (!node) return null;
  const direct = node.childForFieldName && node.childForFieldName('name');
  if (direct) return source.slice(direct.startIndex, direct.endIndex);
  const fallback = firstNamedChildByType(node, new Set([
    'identifier',
    'property_identifier',
    'type_identifier',
  ]));
  return fallback ? source.slice(fallback.startIndex, fallback.endIndex) : null;
}

function compactSignature(node, source, maxLength = 180) {
  const raw = source.slice(node.startIndex, node.endIndex).split('\n')[0].trim();
  return raw.length <= maxLength ? raw : `${raw.slice(0, maxLength - 1)}…`;
}

function extractSemanticMetadata(tree, source) {
  const symbols = [];
  const imports = [];
  const exports = [];
  const references = [];
  const symbolTypes = new Set([
    'function_declaration',
    'generator_function_declaration',
    'class_declaration',
    'method_definition',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
  ]);

  function visit(node, exported = false) {
    let isExported = exported;
    if (node.type === 'export_statement') isExported = true;

    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName && node.childForFieldName('source');
      imports.push({
        source: sourceNode ? source.slice(sourceNode.startIndex, sourceNode.endIndex).replace(/^['"]|['"]$/g, '') : null,
        line: node.startPosition.row + 1,
      });
    }

    if (symbolTypes.has(node.type)) {
      const name = nodeName(node, source);
      if (name) {
        const symbol = {
          name,
          kind: node.type,
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          exported: isExported,
          signature: compactSignature(node, source),
        };
        symbols.push(symbol);
        if (isExported) exports.push(name);
      }
    }

    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      for (let i = 0; i < node.namedChildCount; i += 1) {
        const child = node.namedChild(i);
        if (child.type !== 'variable_declarator') continue;
        const nameNode = child.childForFieldName && child.childForFieldName('name');
        const valueNode = child.childForFieldName && child.childForFieldName('value');
        if (!nameNode) continue;
        const valueType = valueNode ? valueNode.type : '';
        if (valueType === 'arrow_function' || valueType === 'function_expression' || valueType === 'class') {
          const name = source.slice(nameNode.startIndex, nameNode.endIndex);
          symbols.push({
            name,
            kind: valueType,
            line: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            exported: isExported,
            signature: compactSignature(child, source),
          });
          if (isExported) exports.push(name);
        }
      }
    }

    if (node.type === 'call_expression') {
      const fn = node.childForFieldName && node.childForFieldName('function');
      if (fn) {
        const text = source.slice(fn.startIndex, fn.endIndex);
        if (text.length <= 120) references.push(text);
      }
    }

    for (let i = 0; i < node.namedChildCount; i += 1) {
      visit(node.namedChild(i), isExported);
    }
  }

  visit(tree.rootNode, false);
  return { symbols, imports, exports: [...new Set(exports)], references };
}

async function parseSource(source, extension) {
  const language = await getLanguage(extension);
  if (!language) return null;
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  if (!tree) return null;
  try {
    return {
      hasError: tree.rootNode.hasError,
      ...extractSemanticMetadata(tree, source),
    };
  } finally {
    if (tree.delete) tree.delete();
    if (parser.delete) parser.delete();
  }
}

module.exports = {
  initParserRuntime,
  parseSource,
  extractSemanticMetadata,
};
