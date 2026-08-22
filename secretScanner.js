const { execFile } = require('child_process');
const PATTERNS = [
  ['GitHub token', /gh[pousr]_[A-Za-z0-9_]{20,}/g], ['AWS access key', /AKIA[0-9A-Z]{16}/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g], ['Generic API key', /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"\s]{12,}['"]/gi],
];
function git(folder, args) { return new Promise((resolve) => execFile('git', args, { cwd: folder, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (error, stdout) => resolve(error ? '' : String(stdout)))); }
async function scanStaged(folder) { const names = (await git(folder, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'])).split(/\r?\n/).filter(Boolean).slice(0, 500); const findings = []; for (const file of names) { const content = await git(folder, ['show', `:${file}`]); if (!content || content.includes('\0')) continue; for (const [type, pattern] of PATTERNS) { pattern.lastIndex = 0; let match; while ((match = pattern.exec(content))) findings.push({ file, line: content.slice(0, match.index).split('\n').length, type, preview: `${match[0].slice(0, 4)}…[REDACTED]` }); } } return { ok: true, findings }; }
module.exports = { PATTERNS, scanStaged };
