const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const hooksDir = path.join(repoRoot, '.githooks');

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoRoot, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repoRoot, stdio: 'ignore', windowsHide: true });

  // Git silently skips a hook that isn't marked executable - it doesn't fail
  // the command, it just never runs, so a lost +x bit (a fresh checkout on a
  // filesystem that doesn't preserve it, a zip download, etc.) reopens every
  // gate below without any error at all. Re-assert +x on every install so
  // that can't happen quietly.
  for (const hook of fs.readdirSync(hooksDir)) {
    fs.chmodSync(path.join(hooksDir, hook), 0o755);
  }

  console.log('[git hooks] Nexus privacy and inventory pre-push gate enabled.');
} catch {
  console.log('[git hooks] Skipped outside a Git checkout.');
}
