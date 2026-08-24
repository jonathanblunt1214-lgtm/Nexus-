const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ts = require('typescript');

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.nexus-export']);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const RESOLUTION_EXTENSIONS = ['', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.json', '.css', '.html'];
const MAX_FILES = 20000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function isUtf8(content) {
  if (content.includes(0)) return false;
  const text = content.toString('utf8');
  return Buffer.from(text, 'utf8').equals(content);
}

function enumerateProjectFiles(folder) {
  const root = path.resolve(folder);
  if (!fs.statSync(root).isDirectory()) throw new Error('The export source is not a project folder.');
  const files = [];
  let totalBytes = 0;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
      if (entry.isSymbolicLink()) throw new Error(`Export blocked: symbolic link requires manual review: ${path.relative(root, path.join(directory, entry.name))}`);
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        const size = fs.statSync(absolute).size;
        totalBytes += size;
        if (files.length + 1 > MAX_FILES || totalBytes > MAX_TOTAL_BYTES) throw new Error('Export exceeds the protected limit of 20,000 files or 2 GB.');
        files.push({ absolute, relative:path.relative(root, absolute).replace(/\\/g, '/'), size });
      }
    }
  };
  visit(root);
  return { root, files:files.sort((a, b) => a.relative.localeCompare(b.relative)), totalBytes };
}

function relativeCodeReferences(content, fileName) {
  const found = new Set();
  const source = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, false);
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) found.add(node.moduleSpecifier.text.split(/[?#]/)[0]);
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isImport) && node.arguments[0].text.startsWith('.')) found.add(node.arguments[0].text.split(/[?#]/)[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found];
}

function missingReferences(files, contents) {
  const paths = new Set(files.map(file => file.relative));
  const missing = [];
  for (const file of files.filter(item => SOURCE_EXTENSIONS.has(path.extname(item.relative).toLowerCase()))) {
    for (const reference of relativeCodeReferences(contents.get(file.relative).toString('utf8'), file.relative)) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file.relative), reference));
      const resolved = RESOLUTION_EXTENSIONS.map(extension => `${base}${extension}`).find(candidate => paths.has(candidate)) ||
        RESOLUTION_EXTENSIONS.slice(1).map(extension => `${base}/index${extension}`).find(candidate => paths.has(candidate));
      if (!resolved) missing.push({ file:file.relative, reference });
    }
  }
  return missing;
}

async function createExportPreflight({ folder, runCodeCheck }) {
  if (typeof runCodeCheck !== 'function') throw new Error('The Nexus checker API is required for protected export.');
  const inventory = enumerateProjectFiles(folder);
  const contents = new Map();
  const manifestFiles = [];
  const checker = { checked:0, recognized:0, unavailable:[], errors:[] };
  for (const file of inventory.files) {
    const content = fs.readFileSync(file.absolute);
    contents.set(file.relative, content);
    manifestFiles.push({ path:file.relative, size:content.length, sha256:sha256(content) });
    if (!isUtf8(content) || content.length > 5 * 1024 * 1024) continue;
    const result = await runCodeCheck(inventory.root, file.absolute, content.toString('utf8'));
    checker.checked += 1;
    if (!result?.recognized) continue;
    checker.recognized += 1;
    if (!result.available) checker.unavailable.push({ file:file.relative, checker:result.checker, install:result.install || null });
    for (const diagnostic of result.diagnostics || []) if (diagnostic.severity === 'error') checker.errors.push({ file:file.relative, checker:result.checker, line:Number(diagnostic.line || 0) + 1, code:diagnostic.code, message:diagnostic.message });
  }
  const references = missingReferences(inventory.files, contents);
  const manifest = { schemaVersion:1, generatedAt:new Date().toISOString(), source:path.basename(inventory.root), algorithm:'SHA-256', fileCount:manifestFiles.length, totalBytes:inventory.totalBytes, files:manifestFiles };
  return { ok:checker.errors.length === 0 && references.length === 0, manifest, checker, missingReferences:references };
}

function verifyExportFolder(folder, manifest) {
  const actual = enumerateProjectFiles(folder);
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  const changed = [];
  for (const file of actual.files) {
    if (file.relative === 'nexus-export-integrity.json') continue;
    const wanted = expected.get(file.relative);
    const content = fs.readFileSync(file.absolute);
    if (!wanted || content.length !== wanted.size || sha256(content) !== wanted.sha256) changed.push(file.relative);
    expected.delete(file.relative);
  }
  return { ok:changed.length === 0 && expected.size === 0, changed, missing:[...expected.keys()] };
}

async function exportVerifiedProject({ folder, destinationParent, runCodeCheck }) {
  const preflight = await createExportPreflight({ folder, runCodeCheck });
  if (!preflight.ok) return { ...preflight, error:'Export blocked by the linked Nexus checker or a missing local code reference.' };
  const projectName = path.basename(path.resolve(folder)).replace(/[^a-zA-Z0-9._-]+/g, '-') || 'project';
  const destination = path.join(path.resolve(destinationParent), `${projectName}-export`);
  if (fs.existsSync(destination)) return { ...preflight, ok:false, error:`Export destination already exists: ${destination}` };
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-protected-export-'));
  const staged = path.join(temporaryRoot, projectName);
  try {
    fs.cpSync(path.resolve(folder), staged, { recursive:true, filter:source => !source.split(path.sep).some(part => SKIP_DIRECTORIES.has(part)) });
    const stagedResult = verifyExportFolder(staged, preflight.manifest);
    if (!stagedResult.ok) return { ...preflight, ok:false, error:'Export staging integrity verification failed.', integrity:stagedResult };
    fs.writeFileSync(path.join(staged, 'nexus-export-integrity.json'), `${JSON.stringify(preflight.manifest, null, 2)}\n`, 'utf8');
    fs.cpSync(staged, destination, { recursive:true, errorOnExist:true });
    const finalResult = verifyExportFolder(destination, preflight.manifest);
    if (!finalResult.ok) {
      fs.rmSync(destination, { recursive:true, force:true });
      return { ...preflight, ok:false, error:'Final export integrity verification failed; the incomplete export was removed.', integrity:finalResult };
    }
    return { ...preflight, ok:true, path:destination, integrity:finalResult };
  } finally {
    fs.rmSync(temporaryRoot, { recursive:true, force:true });
  }
}

module.exports = { createExportPreflight, exportVerifiedProject, verifyExportFolder, enumerateProjectFiles };
