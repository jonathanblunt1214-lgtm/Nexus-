const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkCode, proposeCheckerFix } = require('../codeChecker');

const root = path.resolve(__dirname, '..');

function git(args) {
  return execFileSync('git', args, { cwd:root, encoding:'utf8' }).trim();
}

async function remediateChangedFiles() {
  const changed = git(['diff', '--name-only', '--diff-filter=ACMR', 'origin/main...HEAD']).split(/\r?\n/).filter(Boolean);
  const fixed = [];
  const unresolved = [];
  for (const relative of changed) {
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).size > 5 * 1024 * 1024) continue;
    const content = fs.readFileSync(filePath);
    if (content.includes(0) || !Buffer.from(content.toString('utf8'), 'utf8').equals(content)) continue;
    const text = content.toString('utf8');
    const before = await checkCode({ folder:root, filePath, content:text, allowExternal:false });
    const errors = (before.diagnostics || []).filter(item => item.severity === 'error');
    if (!before.recognized || !before.available || !errors.length) continue;
    const proposal = await proposeCheckerFix({ folder:root, filePath, content:text, allowExternal:false });
    const afterErrors = (proposal.after?.diagnostics || []).filter(item => item.severity === 'error');
    if (!proposal.ok || !proposal.available || !proposal.fixesApplied || afterErrors.length) {
      unresolved.push({ file:relative, errors:errors.map(item => item.message) });
      continue;
    }
    const temporary = `${filePath}.nexus-promotion-${process.pid}.tmp`;
    fs.writeFileSync(temporary, proposal.correctedContent, 'utf8');
    fs.renameSync(temporary, filePath);
    fixed.push(relative);
  }
  return { fixed, unresolved };
}

async function main() {
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'verifyRepositoryInventory.js')], { cwd:root, stdio:'inherit' });
  } catch {
    execFileSync(process.execPath, [path.join(__dirname, 'repairRepositoryInventory.js')], { cwd:root, stdio:'inherit', env:{ ...process.env, NEXUS_REPAIR_REF:git(['rev-parse', 'HEAD']) } });
  }
  const result = await remediateChangedFiles();
  if (result.fixed.length) execFileSync(process.execPath, [path.join(__dirname, 'verifyRepositoryInventory.js'), '--write'], { cwd:root, stdio:'inherit' });
  console.log(JSON.stringify(result));
  if (result.unresolved.length) throw new Error('Deterministic checker could not safely rewrite every failing changed file. Upgrade was preserved for review.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { remediateChangedFiles };
