const path = require('path');
const { spawnSync } = require('child_process');
const { scrubRepository } = require('./scrubRepositoryPrivacy');

const root = path.resolve(__dirname, '..');
function verify() { return spawnSync(process.execPath, [path.join(__dirname, 'verifyRepositoryPrivacy.js')], { cwd:root, stdio:'inherit', windowsHide:true }).status === 0; }

if (!verify()) {
  console.error('[privacy retry] Privacy data was detected. Running the scrubber and checking again.');
  const result = scrubRepository(root);
  if (!verify()) process.exitCode = 1;
  else if (result.total && !process.argv.includes('--allow-repaired')) {
    console.error('[privacy retry] Scrubbing succeeded, but this push remains blocked. Commit the staged sanitized files so private data cannot remain in Git history.');
    process.exitCode = 1;
  }
}
