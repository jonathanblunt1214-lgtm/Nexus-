const { execFileSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const CLUTTER_PATH = /(^|\/)(?:node_modules|dist|out|coverage|tmp|temp|logs?)(?:\/|$)|(?:~|\.bak|\.old|\.orig|\.rej|\.tmp|\.log|\.DS_Store|Thumbs\.db|desktop\.ini)$/i;
const OBSOLETE_PATHS = new Set([
  '.github/workflows/promote-upgrade-to-main.yml',
  '.github/workflows/sync-upgrade-branch.yml',
  'scripts/promoteTestedUpgrade.js',
  'scripts/remediateUpgradeForPromotion.js',
]);

function git(args, options = {}) {
  return execFileSync('git', args, { cwd:options.root || root, encoding:'utf8', windowsHide:true }).trim();
}

function auditRepository(options = {}) {
  const cwd = options.root || root;
  const files = git(['ls-files', '-z'], { root:cwd }).split('\0').filter(Boolean);
  const findings = [];
  const hashes = new Map();
  for (const file of files) {
    const size = Number(git(['cat-file', '-s', `:${file}`], { root:cwd }));
    if (size === 0) findings.push({ type:'empty tracked file', path:file });
    if (CLUTTER_PATH.test(file)) findings.push({ type:'generated or temporary path', path:file });
    if (OBSOLETE_PATHS.has(file)) findings.push({ type:'obsolete development-branch path', path:file });
    const hash = git(['rev-parse', `:${file}`], { root:cwd });
    const duplicates = hashes.get(hash) || [];
    duplicates.push(file);
    hashes.set(hash, duplicates);
  }
  const ignored = git(['ls-files', '-ci', '--exclude-standard', '-z'], { root:cwd }).split('\0').filter(Boolean);
  for (const file of ignored) findings.push({ type:'tracked file is ignored', path:file });
  for (const paths of hashes.values()) {
    if (paths.length > 1) findings.push({ type:'duplicate tracked content', path:paths.join(' == ') });
  }
  return { files:files.length, findings };
}

function main() {
  const result = auditRepository();
  if (result.findings.length) {
    console.error(`[clutter audit] Found ${result.findings.length} cleanup candidate(s):`);
    for (const finding of result.findings) console.error(`- ${finding.type}: ${finding.path}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[clutter audit] PASS: ${result.files} tracked files contain no empty, temporary, generated, ignored, duplicate, or obsolete branch-era clutter.`);
}

if (require.main === module) main();
module.exports = { CLUTTER_PATH, OBSOLETE_PATHS, auditRepository };
