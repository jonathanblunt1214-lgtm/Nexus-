const { execFileSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');

function git(args, options = {}) {
  const result = execFileSync('git', args, { cwd:options.root || root, encoding:'utf8', windowsHide:true, stdio:options.inherit ? 'inherit' : undefined });
  return typeof result === 'string' ? result.trim() : '';
}

function maintainRepository(options = {}) {
  const cwd = options.root || root;
  const before = git(['count-objects', '-v'], { root:cwd });
  git(['fsck', '--full', '--strict', '--no-dangling'], { root:cwd, inherit:true });
  if (!options.verifyOnly) {
    // This is Git's safe equivalent of defragmentation. It repacks reachable
    // objects without rebasing, squashing, force-pushing, or rewriting refs.
    git(['repack', '-Ad'], { root:cwd, inherit:true });
    git(['prune-packed'], { root:cwd, inherit:true });
  }
  git(['fsck', '--full', '--strict', '--no-dangling'], { root:cwd, inherit:true });
  const after = git(['count-objects', '-v'], { root:cwd });
  return { before, after, verifyOnly:Boolean(options.verifyOnly) };
}

if (require.main === module) {
  try {
    const result = maintainRepository({ verifyOnly:process.argv.includes('--verify-only') });
    console.log(`[repository maintenance] PASS: integrity verified${result.verifyOnly ? '' : ' and reachable Git objects safely repacked'} without rewriting branch history.`);
    console.log(`[repository maintenance] Before\n${result.before}\n[repository maintenance] After\n${result.after}`);
  } catch (error) {
    console.error(`[repository maintenance] FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { maintainRepository };
