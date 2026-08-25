const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PRIVATE_FILES } = require('./verifyRepositoryPrivacy');

function scrubText(value, options = {}) {
  const redactEmails = options.redactEmails !== false;
  const scrubbed = String(value)
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/[A-Za-z]:\\Users\\(?!USER(?:_HOME)?\\|example(?:-user)?\\|developer\\)[^\\\s"']+\\/gi, (match) => `${match[0]}:\\Users\\USER_HOME\\`)
    .replace(/[A-Za-z]:\\My Drive\\/gi, 'DRIVE_HOME\\');
  return redactEmails
    ? scrubbed.replace(/\b(?!git@github\.com\b)[A-Z0-9._%+-]+@(?!example\.(?:com|org|net|test)\b|localhost\b|users\.noreply\.github\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    : scrubbed;
}

function git(root, args) { return execFileSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true }).trim(); }

function scrubRepository(root = path.resolve(__dirname, '..')) {
  const tracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  const changed = []; const untrackedPrivateFiles = [];
  for (const relative of tracked) {
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`)) continue;
    if (PRIVATE_FILES.some((rule) => rule.test(relative))) {
      execFileSync('git', ['rm', '--cached', '--ignore-unmatch', '--', relative], { cwd:root, stdio:'ignore', windowsHide:true });
      untrackedPrivateFiles.push(relative);
      continue;
    }
    if (!fs.existsSync(target) || fs.statSync(target).size > 5 * 1024 * 1024) continue;
    const buffer = fs.readFileSync(target); if (buffer.includes(0)) continue;
    const before = buffer.toString('utf8');
    const after = scrubText(before, { redactEmails: !/(?:^|\/)package-lock\.json$/i.test(relative) });
    if (after === before) continue;
    fs.writeFileSync(target, after, 'utf8');
    execFileSync('git', ['add', '--', relative], { cwd:root, stdio:'ignore', windowsHide:true });
    changed.push(relative);
  }
  if (changed.length || untrackedPrivateFiles.length) {
    execFileSync(process.execPath, [path.join(__dirname, 'verifyRepositoryInventory.js'), '--write'], { cwd:root, stdio:'inherit', windowsHide:true });
    execFileSync('git', ['add', '--', 'repository-file-manifest.json'], { cwd:root, stdio:'ignore', windowsHide:true });
  }
  const result = { changed, untrackedPrivateFiles, total:changed.length + untrackedPrivateFiles.length };
  console.log(`[privacy scrubber] Sanitized ${result.total} tracked file(s); secret values were not printed.`);
  return result;
}

if (require.main === module) {
  try { scrubRepository(); } catch (error) { console.error(`[privacy scrubber] Failed safely: ${error.message}`); process.exitCode = 1; }
}
module.exports = { scrubText, scrubRepository };
