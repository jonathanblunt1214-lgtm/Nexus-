const { execFileSync } = require('child_process');
const path = require('path');

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore', windowsHide: true });
  console.log('[git hooks] Nexus privacy and inventory pre-push gate enabled.');
} catch {
  console.log('[git hooks] Skipped outside a Git checkout.');
}
