const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const ts = require('typescript');
const { canonicalContent } = require('./inventoryContent');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'repository-file-manifest.json');
const manifestRelative = 'repository-file-manifest.json';

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd:root, encoding:'utf8' }).split('\0').filter(Boolean).filter((file) => file !== manifestRelative).sort();
}

const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const resolutionExtensions = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.css', '.html'];

function relativeReferences(content, fileName) {
  const found = new Set();
  const source = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, false);
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) found.add(node.moduleSpecifier.text.split(/[?#]/)[0]);
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isImport) && node.arguments[0].text.startsWith('.')) found.add(node.arguments[0].text.split(/[?#]/)[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...found];
}

function crossReference(files) {
  const paths = new Set(files);
  const references = [];
  const missing = [];
  for (const source of files.filter((file) => sourceExtensions.has(path.extname(file).toLowerCase()))) {
    const content = fs.readFileSync(path.join(root, source), 'utf8');
    for (const reference of relativeReferences(content, source)) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(source), reference));
      const resolved = resolutionExtensions.map((extension) => `${base}${extension}`).find((candidate) => paths.has(candidate)) ||
        resolutionExtensions.slice(1).map((extension) => `${base}/index${extension}`).find((candidate) => paths.has(candidate));
      if (resolved) references.push({ source, reference, resolved });
      else missing.push({ source, reference });
    }
  }
  return { references, missing };
}

function inventory() {
  return trackedFiles().map((file) => {
    const content = canonicalContent(fs.readFileSync(path.join(root, file)));
    return { path:file.replace(/\\/g, '/'), type:path.extname(file).toLowerCase() || '[no extension]', size:content.length, sha256:crypto.createHash('sha256').update(content).digest('hex') };
  });
}

function generatedManifest() {
  const files = inventory();
  const crossReferences = crossReference(files.map((file) => file.path));
  const types = {};
  for (const file of files) types[file.type] = (types[file.type] || 0) + 1;
  return { schemaVersion:1, scope:'Nexus only: every Git-tracked Nexus file except this self-referential manifest', generatedBy:'npm run inventory:update', fileCount:files.length, types, crossReferences:crossReferences.references, missingCrossReferences:crossReferences.missing, files };
}

if (process.argv.includes('--write')) {
  const manifest = generatedManifest();
  if (manifest.missingCrossReferences.length) throw new Error(`Nexus has missing relative references: ${JSON.stringify(manifest.missingCrossReferences)}`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[inventory] Recorded every tracked Nexus file (${manifest.fileCount}) and ${manifest.crossReferences.length} local cross-references.`);
  process.exit(0);
}

if (!fs.existsSync(manifestPath)) throw new Error('repository-file-manifest.json is missing. Run npm run inventory:update.');
const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const actual = generatedManifest();
if (actual.missingCrossReferences.length) throw new Error(`Nexus has missing relative references: ${JSON.stringify(actual.missingCrossReferences)}`);
const expectedMap = new Map((expected.files || []).map((file) => [file.path, file]));
const actualMap = new Map(actual.files.map((file) => [file.path, file]));
const added = [...actualMap.keys()].filter((file) => !expectedMap.has(file));
const removed = [...expectedMap.keys()].filter((file) => !actualMap.has(file));
const changed = [...actualMap.keys()].filter((file) => expectedMap.has(file) && expectedMap.get(file).sha256 !== actualMap.get(file).sha256);
if (added.length || removed.length || changed.length) {
  throw new Error(`Repository inventory is stale. Added: ${added.join(', ') || 'none'}. Removed: ${removed.join(', ') || 'none'}. Changed: ${changed.join(', ') || 'none'}. Run npm run inventory:update after reviewing every change.`);
}
if (expected.fileCount !== actual.fileCount) throw new Error(`Repository inventory count mismatch: expected ${expected.fileCount}, found ${actual.fileCount}.`);
console.log(`[inventory] Verified every tracked Nexus file (${actual.fileCount}) across ${Object.keys(actual.types).length} explicit file types.`);
