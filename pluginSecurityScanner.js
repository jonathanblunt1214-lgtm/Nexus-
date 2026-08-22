const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const MAX_FILES = 250;
const MAX_BYTES = 15 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set(['.exe', '.dll', '.msi', '.scr', '.com', '.bat', '.cmd', '.ps1', '.vbs', '.jscript', '.lnk', '.node']);
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.json', '.html', '.css', '.md', '.txt']);
const RULES = [
  { id: 'shell-execution', severity: 'critical', score: 100, pattern: /\b(child_process|execFileSync|execSync|spawnSync|powershell(?:\.exe)?|cmd(?:\.exe)?|wscript|cscript)\b/i, message: 'Attempts to start shell commands or external programs.' },
  { id: 'credential-access', severity: 'critical', score: 100, pattern: /\b(Credential Manager|Login Data|Cookies|Local State|keytar|dpapi|CryptUnprotectData|process\.env)\b/i, message: 'Attempts to access credentials, browser data, or environment secrets.' },
  { id: 'persistence', severity: 'critical', score: 100, pattern: /\b(CurrentVersion\\Run|schtasks|Startup\\|reg(?:\.exe)?\s+add|sc(?:\.exe)?\s+create)\b/i, message: 'Attempts to establish automatic startup or system persistence.' },
  { id: 'ransomware-pattern', severity: 'critical', score: 100, pattern: /\b(readdirSync|walkSync|globSync)\b[\s\S]{0,800}\b(cipheriv|unlinkSync|renameSync|rmSync)\b/i, message: 'Combines broad file discovery with encryption, deletion, or renaming.' },
  { id: 'dynamic-code', severity: 'high', score: 70, pattern: /\b(eval|Function)\s*\(|vm\.(runIn|compileFunction)/i, message: 'Uses dynamic code execution that cannot be safely inspected.' },
  { id: 'encoded-payload', severity: 'high', score: 70, pattern: /(?:fromCharCode\s*\(|atob\s*\(|Buffer\.from\([^\n]{0,160}base64)[\s\S]{0,300}\b(eval|Function)\b/i, message: 'Builds and executes an encoded or obfuscated payload.' },
  { id: 'raw-network', severity: 'medium', score: 25, pattern: /\b(fetch|WebSocket|https?\.request|net\.connect|dgram\.createSocket)\b/i, message: 'Contains direct network behavior; declared capabilities will still be enforced.' },
];

function enumeratePluginFiles(root) {
  const base = fs.realpathSync(path.resolve(root));
  const files = [];
  let totalBytes = 0;
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Plug-ins containing symbolic links are not accepted.');
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const size = fs.statSync(full).size;
        totalBytes += size;
        files.push({ full, relative: path.relative(base, full), size });
        if (files.length > MAX_FILES || totalBytes > MAX_BYTES) throw new Error('Plug-in exceeds the 250-file or 15 MB screening limit.');
      }
    }
  }
  visit(base);
  return { base, files, totalBytes };
}

function hashPluginDirectory(root) {
  const inventory = enumeratePluginFiles(root);
  const hash = crypto.createHash('sha256');
  for (const file of inventory.files.sort((a, b) => a.relative.localeCompare(b.relative))) {
    hash.update(file.relative.replace(/\\/g, '/')); hash.update('\0'); hash.update(fs.readFileSync(file.full)); hash.update('\0');
  }
  return hash.digest('hex');
}

function staticBehaviorScan(root) {
  const inventory = enumeratePluginFiles(root);
  const findings = [];
  for (const file of inventory.files) {
    const extension = path.extname(file.relative).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(extension)) findings.push({ rule: 'unsafe-binary', severity: 'critical', file: file.relative, message: `Executable file type ${extension} is not allowed.` });
    if (!SOURCE_EXTENSIONS.has(extension) || file.size > 1024 * 1024) continue;
    const content = fs.readFileSync(file.full, 'utf8');
    for (const rule of RULES) if (rule.pattern.test(content)) findings.push({ rule: rule.id, severity: rule.severity, score: rule.score, file: file.relative, message: rule.message });
  }
  const score = Math.min(100, findings.reduce((total, item) => total + Number(item.score || (item.severity === 'critical' ? 100 : 0)), 0));
  return { passed: !findings.some((item) => item.severity === 'critical') && score < 70, score, findings, fileCount: inventory.files.length, totalBytes: inventory.totalBytes, digest: hashPluginDirectory(root) };
}

function defenderCandidates() {
  const candidates = [];
  const platformRoot = process.env.ProgramData && path.join(process.env.ProgramData, 'Microsoft', 'Windows Defender', 'Platform');
  if (platformRoot && fs.existsSync(platformRoot)) {
    for (const entry of fs.readdirSync(platformRoot).sort().reverse()) candidates.push(path.join(platformRoot, entry, 'MpCmdRun.exe'));
  }
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, 'Windows Defender', 'MpCmdRun.exe'));
  return candidates.filter((candidate) => fs.existsSync(candidate));
}

async function scanWithMicrosoftDefender(target) {
  if (process.platform !== 'win32') throw new Error('Microsoft Defender screening is required for plug-in uploads on this build.');
  const executable = defenderCandidates()[0];
  if (!executable) throw new Error('Microsoft Defender could not be found. Turn on Windows Security before uploading a plug-in.');
  try {
    await execFileAsync(executable, ['-Scan', '-ScanType', '3', '-File', fs.realpathSync(target), '-DisableRemediation'], { windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 });
    return { passed: true, engine: 'Microsoft Defender' };
  } catch (error) {
    throw new Error(`Microsoft Defender blocked or could not clear this plug-in (code ${error.code ?? 'unknown'}).`);
  }
}

async function screenPlugin(root, { defenderScan = scanWithMicrosoftDefender } = {}) {
  const defender = await defenderScan(root);
  const behavior = staticBehaviorScan(root);
  return { passed: defender.passed === true && behavior.passed, defender, behavior };
}

module.exports = { screenPlugin, staticBehaviorScan, scanWithMicrosoftDefender, hashPluginDirectory, enumeratePluginFiles };
