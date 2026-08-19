// pureLogic.js — genuinely pure functions extracted out of main.js so they
// can be tested in isolation with `node --test`, without needing a live
// Electron environment. Every function here takes plain inputs and returns
// plain outputs, with no fs/path/child_process/Electron dependency - if a
// function needed any of those, it stayed in main.js instead.

function sanitizeProjectFolderName(name) {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._ -]/g, '').trim().replace(/\s+/g, '-');
  return cleaned || 'new-project';
}

function parseGeneratedFiles(text) {
  const fileRegex = /===FILE:\s*(.+?)===\r?\n([\s\S]*?)===END FILE===/g;
  const files = [];
  let match;
  while ((match = fileRegex.exec(text)) !== null) {
    const relPath = match[1].trim();
    let content = match[2];
    // Strip a single leading/trailing newline that commonly wraps the block.
    content = content.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    if (relPath) files.push({ relPath, content });
  }
  return files;
}

function detectStartCommand(files) {
  const pkgFile = files.find((f) => f.relPath === 'package.json');
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      if (pkg.scripts?.dev) return 'npm run dev';
      if (pkg.scripts?.start) return 'npm start';
    } catch {
      // fall through to default below
    }
  }
  return 'npm run dev';
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseUnifiedDiff(rawDiff) {
  const files = [];
  let current = null;
  let currentHunk = null;

  const lines = rawDiff.split('\n');
  for (const line of lines) {
    const fileMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (fileMatch) {
      current = { relPath: fileMatch[2], status: 'M', hunks: [] };
      files.push(current);
      currentHunk = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    if (line.startsWith('@@')) {
      currentHunk = { header: line, lines: [] };
      current.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith('+')) currentHunk.lines.push({ type: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) currentHunk.lines.push({ type: 'del', text: line.slice(1) });
    else currentHunk.lines.push({ type: 'context', text: line.slice(1) });
  }
  return files;
}

function parseJestStyleResults(jsonText) {
  const parsed = JSON.parse(jsonText);
  const tests = [];
  for (const fileResult of parsed.testResults || []) {
    for (const t of fileResult.assertionResults || []) {
      tests.push({
        name: t.fullName || t.title,
        status: t.status === 'passed' ? 'pass' : t.status === 'pending' || t.status === 'skipped' ? 'skip' : 'fail',
        duration: t.duration || null,
        failureMessage: (t.failureMessages || []).join('\n\n') || null,
      });
    }
  }
  return { tests, numPassed: parsed.numPassedTests, numFailed: parsed.numFailedTests, numSkipped: parsed.numPendingTests };
}

module.exports = {
  sanitizeProjectFolderName,
  parseGeneratedFiles,
  detectStartCommand,
  escapeRegex,
  parseUnifiedDiff,
  parseJestStyleResults,
};
