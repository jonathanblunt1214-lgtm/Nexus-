const { execFileSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true })
  .split('\0').filter(Boolean);

const PRIVATE_FILES = [
  /(^|\/)(?:\.env(?:\..+)?|.*\.pfx|.*\.p12|.*\.key|account-vault(?:\..+)?|nexus-user-data(?:\..+)?|nexus-config\.json)$/i,
];
const CONTENT_RULES = [
  ['GitHub credential', /gh[pousr]_[A-Za-z0-9_]{20,}/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['personal Windows user path', /[A-Za-z]:\\Users\\(?!USER(?:_HOME)?\\|example(?:-user)?\\|developer\\)[^\\\s"']+\\/gi],
  ['personal Google Drive path', /[A-Za-z]:\\My Drive\\/gi],
  ['personal email address', /\b(?!git@github\.com\b)[A-Z0-9._%+-]+@(?!example\.(?:com|org|net|test)\b|localhost\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
];

const findings = [];
for (const file of tracked) {
  if (PRIVATE_FILES.some((rule) => rule.test(file))) findings.push({ file, line: 1, type: 'private user-state file' });
  let content;
  try { content = execFileSync('git', ['show', `:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 }); }
  catch { continue; }
  if (!content || content.includes('\0')) continue;
  for (const [type, rule] of CONTENT_RULES) {
    if (type === 'personal email address' && /(?:^|\/)package-lock\.json$/i.test(file)) continue;
    rule.lastIndex = 0;
    let match;
    while ((match = rule.exec(content))) findings.push({ file, line: content.slice(0, match.index).split('\n').length, type });
  }
}

if (findings.length) {
  console.error('[privacy gate] Upload blocked. Remove private data from these tracked files:');
  for (const finding of findings) console.error(`- ${finding.file}:${finding.line} (${finding.type})`);
  process.exit(1);
}
console.log(`[privacy gate] Verified ${tracked.length} tracked Nexus files contain no recognized credentials, personal paths, personal email addresses, or local account-state files.`);

module.exports = { PRIVATE_FILES, CONTENT_RULES };
