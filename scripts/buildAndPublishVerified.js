const path = require('path');
const { execFileSync } = require('child_process');
const { verifySourcePackageList, verifyPackagedContents } = require('./verifyPackagedContents');

const root = path.resolve(__dirname, '..');
const electronBuilder = process.platform === 'win32'
  ? path.join(root, 'node_modules', '.bin', 'electron-builder.cmd')
  : path.join(root, 'node_modules', '.bin', 'electron-builder');

execFileSync(process.execPath, [path.join(__dirname, 'releaseStressGate.js')], { cwd:root, stdio:'inherit' });

try {
  execFileSync(process.execPath, [path.join(__dirname, 'verifyRepositoryInventory.js')], { cwd:root, stdio:'inherit' });
  verifySourcePackageList();
} catch {
  execFileSync(process.execPath, [path.join(__dirname, 'repairRepositoryInventory.js')], { cwd:root, stdio:'inherit' });
  verifySourcePackageList();
}
execFileSync(electronBuilder, ['--win', 'nsis', '--publish', 'never'], { cwd:root, stdio:'inherit' });
verifyPackagedContents();
execFileSync(electronBuilder, ['--win', 'nsis', '--prepackaged', 'dist/win-unpacked', '--publish', 'always'], { cwd:root, stdio:'inherit' });
