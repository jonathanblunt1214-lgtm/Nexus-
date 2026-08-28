const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function replaceOnce(file, before, after) {
  const full = path.join(root, file);
  const source = fs.readFileSync(full, 'utf8');
  if (source.includes(after)) return false;
  if (!source.includes(before)) throw new Error(`${file}: expected patch anchor not found`);
  fs.writeFileSync(full, source.replace(before, after));
  return true;
}

replaceOnce(
  'renderer.js',
  "async function checkForReleaseUpdate() {",
  "window.nexus.onUpdaterStatus(renderReleaseUpdateStatus);\n\nasync function checkForReleaseUpdate() {"
);

const clutterPath = path.join(root, 'scripts', 'repositoryClutterAudit.js');
let clutter = fs.readFileSync(clutterPath, 'utf8');
if (!clutter.includes("function loadGovernedClutterAllow")) {
  clutter = clutter.replace(
    "const { execFileSync } = require('child_process');\nconst path = require('path');",
    "const { execFileSync } = require('child_process');\nconst fs = require('fs');\nconst path = require('path');"
  );
  clutter = clutter.replace(
    "function auditRepository(options = {}) {\n  const cwd = options.root || root;\n  const files = git(['ls-files', '-z'], { root:cwd }).split('\\0').filter(Boolean);",
    `function loadGovernedClutterAllow(cwd) {\n  try {\n    const config = JSON.parse(fs.readFileSync(path.join(cwd, '.thecrucible.json'), 'utf8'));\n    const now = Date.now();\n    return new Set((config.clutter?.allow || [])\n      .filter((entry) => entry && typeof entry.path === 'string')\n      .filter((entry) => !entry.expires || Date.parse(\`${'${entry.expires}'}T23:59:59Z\`) >= now)\n      .map((entry) => entry.path));\n  } catch {\n    return new Set();\n  }\n}\n\nfunction auditRepository(options = {}) {\n  const cwd = options.root || root;\n  const allowed = loadGovernedClutterAllow(cwd);\n  const files = git(['ls-files', '-z'], { root:cwd }).split('\\0').filter(Boolean);`
  );
  clutter = clutter.replace(
    "  for (const file of files) {\n    const size = Number(git(['cat-file', '-s', `:${file}`], { root:cwd }));\n    if (size === 0) findings.push({ type:'empty tracked file', path:file });\n    if (CLUTTER_PATH.test(file)) findings.push({ type:'generated or temporary path', path:file });\n    if (OBSOLETE_PATHS.has(file)) findings.push({ type:'obsolete development-branch path', path:file });\n    const hash = git(['rev-parse', `:${file}`], { root:cwd });\n    const duplicates = hashes.get(hash) || [];\n    duplicates.push(file);\n    hashes.set(hash, duplicates);\n  }",
    "  for (const file of files) {\n    if (allowed.has(file)) continue;\n    const size = Number(git(['cat-file', '-s', `:${file}`], { root:cwd }));\n    if (size === 0) findings.push({ type:'empty tracked file', path:file });\n    if (CLUTTER_PATH.test(file)) findings.push({ type:'generated or temporary path', path:file });\n    if (OBSOLETE_PATHS.has(file)) findings.push({ type:'obsolete development-branch path', path:file });\n    const hash = git(['rev-parse', `:${file}`], { root:cwd });\n    const duplicates = hashes.get(hash) || [];\n    duplicates.push(file);\n    hashes.set(hash, duplicates);\n  }"
  );
  clutter = clutter.replace(
    "module.exports = { CLUTTER_PATH, OBSOLETE_PATHS, auditRepository };",
    "module.exports = { CLUTTER_PATH, OBSOLETE_PATHS, loadGovernedClutterAllow, auditRepository };"
  );
  fs.writeFileSync(clutterPath, clutter);
}

const maintenanceTest = path.join(root, 'test', 'repositoryMaintenance.test.js');
let maintenance = fs.readFileSync(maintenanceTest, 'utf8');
if (!maintenance.includes('governed Crucible clutter exceptions')) {
  maintenance += `\n\ntest('daily audit honors governed Crucible clutter exceptions without allowing duplicates globally', () => {\n  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-governed-clutter-'));\n  git(root, ['init']);\n  git(root, ['config', 'user.name', 'Nexus Test']);\n  git(root, ['config', 'user.email', 'nexus@example.test']);\n  fs.mkdirSync(path.join(root, 'governingDocuments', 'native'), { recursive:true });\n  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'same governance\\n');\n  fs.writeFileSync(path.join(root, 'governingDocuments', 'native', 'AGENTS.md'), 'same governance\\n');\n  fs.writeFileSync(path.join(root, '.thecrucible.json'), JSON.stringify({ clutter:{ allow:[{ path:'governingDocuments/native/AGENTS.md', expires:'2099-01-01' }], allowDuplicateContent:false } }));\n  git(root, ['add', '.']);\n  assert.equal(auditRepository({ root }).findings.length, 0);\n  fs.writeFileSync(path.join(root, 'COPY.md'), 'same governance\\n');\n  git(root, ['add', 'COPY.md']);\n  assert.match(auditRepository({ root }).findings.map((item) => item.type).join(' '), /duplicate tracked content/);\n});\n`;
  fs.writeFileSync(maintenanceTest, maintenance);
}

console.log('Applied Crucible internal-check repairs.');
