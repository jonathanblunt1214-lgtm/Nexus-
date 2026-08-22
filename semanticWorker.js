// semanticWorker.js
// Background repository parser for structural context generation.

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs').promises;
const path = require('path');
const { parseSource } = require('./astEngine');
const { indexWorkspace } = require('./workspaceIndexer');

const SUPPORTED_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage']);
const MAX_FILES = 20000;
const MAX_FILE_SIZE = 1_000_000;
const DEFAULT_MAP_CHAR_BUDGET = 4096;

async function walk(dir, out = []) {
  if (out.length >= MAX_FILES) return out;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(fullPath, out);
    } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(fullPath);
    }
  }
  return out;
}

async function readSource(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) return null;
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function resolveImport(fromFile, specifier, knownFiles) {
  if (!specifier || !specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  const candidates = [
    base,
    ...Array.from(SUPPORTED_EXTENSIONS, (ext) => `${base}${ext}`),
    ...Array.from(SUPPORTED_EXTENSIONS, (ext) => path.posix.join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => knownFiles.has(candidate)) || null;
}

function rankFiles(parsedFiles) {
  const knownFiles = new Set(parsedFiles.map((file) => file.path));
  const inbound = new Map(parsedFiles.map((file) => [file.path, 0]));
  const outbound = new Map(parsedFiles.map((file) => [file.path, []]));

  for (const file of parsedFiles) {
    for (const item of file.imports || []) {
      const target = resolveImport(file.path, item.source, knownFiles);
      if (!target) continue;
      outbound.get(file.path).push(target);
      inbound.set(target, (inbound.get(target) || 0) + 1);
    }
  }

  let scores = new Map(parsedFiles.map((file) => [file.path, 1]));
  const damping = 0.85;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const next = new Map();
    for (const file of parsedFiles) {
      let score = 1 - damping;
      for (const source of parsedFiles) {
        const edges = outbound.get(source.path) || [];
        if (edges.includes(file.path) && edges.length) {
          score += damping * (scores.get(source.path) || 1) / edges.length;
        }
      }
      const exportedBoost = Math.min((file.exports || []).length * 0.08, 0.4);
      const inboundBoost = Math.min((inbound.get(file.path) || 0) * 0.04, 0.4);
      next.set(file.path, score + exportedBoost + inboundBoost);
    }
    scores = next;
  }

  return parsedFiles
    .map((file) => ({ ...file, relevance: Number((scores.get(file.path) || 0).toFixed(4)) }))
    .sort((a, b) => b.relevance - a.relevance || a.path.localeCompare(b.path));
}

function buildRepositoryMap(rankedFiles, maxChars = DEFAULT_MAP_CHAR_BUDGET) {
  const lines = [];
  let used = 0;
  for (const file of rankedFiles) {
    const header = `${file.path} [score=${file.relevance}]`;
    if (used + header.length + 1 > maxChars) break;
    lines.push(header);
    used += header.length + 1;

    for (const symbol of file.symbols || []) {
      const marker = symbol.exported ? 'export ' : '';
      const line = `  L${symbol.line} ${marker}${symbol.kind}: ${symbol.name}`;
      if (used + line.length + 1 > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    if (used >= maxChars) break;
  }
  return lines.join('\n');
}

async function buildSemanticContext(projectPath, previousIndex = {}, mapCharBudget = DEFAULT_MAP_CHAR_BUDGET) {
  const files = await walk(projectPath);
  const sourceFiles = [];
  for (const absolutePath of files) {
    const content = await readSource(absolutePath);
    if (content == null) continue;
    sourceFiles.push({
      path: path.relative(projectPath, absolutePath).split(path.sep).join('/'),
      absolutePath,
      content,
      extension: path.extname(absolutePath).toLowerCase(),
    });
  }

  const workspace = indexWorkspace(sourceFiles, previousIndex);
  const changedSet = new Set(workspace.changed);
  const parsedFiles = [];
  const parseErrors = [];

  for (const file of sourceFiles) {
    try {
      const metadata = await parseSource(file.content, file.extension);
      if (!metadata) continue;
      parsedFiles.push({
        path: file.path,
        hash: workspace.hashes[file.path],
        changed: changedSet.has(file.path),
        ...metadata,
      });
      if (metadata.hasError) parseErrors.push(file.path);
    } catch (err) {
      parseErrors.push(`${file.path}: ${err.message}`);
    }
  }

  const rankedFiles = rankFiles(parsedFiles);
  return {
    generatedAt: new Date().toISOString(),
    projectPath,
    rootHash: workspace.rootHash,
    index: workspace.hashes,
    changedFiles: workspace.changed,
    unchangedFiles: workspace.unchanged,
    removedFiles: workspace.removed,
    filesParsed: parsedFiles.length,
    parseErrors,
    repositoryMap: buildRepositoryMap(rankedFiles, mapCharBudget),
    files: rankedFiles.map((file) => ({
      path: file.path,
      hash: file.hash,
      changed: file.changed,
      relevance: file.relevance,
      symbols: file.symbols,
      imports: file.imports,
      exports: file.exports,
      references: file.references,
      hasError: file.hasError,
    })),
  };
}

if (parentPort) {
  buildSemanticContext(
    workerData.projectPath,
    workerData.previousIndex || {},
    workerData.mapCharBudget || DEFAULT_MAP_CHAR_BUDGET
  )
    .then((context) => parentPort.postMessage({ ok: true, context }))
    .catch((err) => parentPort.postMessage({ ok: false, error: err.message }));
}

module.exports = {
  buildSemanticContext,
  buildRepositoryMap,
  rankFiles,
};
