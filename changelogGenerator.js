// changelogGenerator.js
// Main-process module: builds a changelog of only the AI-related commits in
// a project's git history, by filtering real `git log` output - nothing is
// summarized or guessed by a model here, it's a filter over actual commits.
// Runs git via execFile with an argv array (no shell), consistent with the
// rest of Nexus's git handling in main.js.

const fs = require('fs');
const { execFile } = require('child_process');

const AI_KEYWORD_PATTERN = /\b(ai|gemini|gpt|claude|llm|model|prompt|guardrail|nim|genai)\b/i;
const UNIT_SEP = ''; // unlikely to appear in a commit subject
const RECORD_SEP = '';

function runGitLog(projectPath, fetchCount) {
  return new Promise((resolve) => {
    const format = `%H${UNIT_SEP}%ad${UNIT_SEP}%an${UNIT_SEP}%s${RECORD_SEP}`;
    execFile(
      'git',
      ['log', `-n${fetchCount}`, '--name-only', `--pretty=format:${format}`, '--date=short'],
      { cwd: projectPath, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) { resolve(null); return; }
        resolve(stdout || '');
      }
    );
  });
}

function parseGitLog(raw) {
  return raw
    .split(RECORD_SEP)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const [hash, date, author, subject] = lines[0].split(UNIT_SEP);
      const files = lines.slice(1).map((l) => l.trim()).filter(Boolean);
      return { hash, date, author, subject, files };
    });
}

/**
 * Returns up to `limit` commits that touch AI-related files or mention
 * AI-related terms in the commit message, newest first.
 */
async function generateAIChangelog(projectPath, { limit = 30 } = {}) {
  if (!projectPath || !fs.existsSync(projectPath)) return { ok: false, error: 'Folder not found.' };

  // Over-fetch, since most commits won't be AI-related - then filter down.
  const raw = await runGitLog(projectPath, Math.max(limit * 5, 200));
  if (raw === null) return { ok: false, error: 'Not a git repository, or git is unavailable.' };

  const commits = parseGitLog(raw);
  const aiCommits = commits.filter((c) =>
    AI_KEYWORD_PATTERN.test(c.subject) || c.files.some((f) => AI_KEYWORD_PATTERN.test(f))
  );

  return {
    ok: true,
    projectPath,
    totalCommitsScanned: commits.length,
    entries: aiCommits.slice(0, limit).map((c) => ({
      hash: c.hash.slice(0, 10),
      date: c.date,
      author: c.author,
      subject: c.subject,
      files: c.files.slice(0, 10),
    })),
  };
}

module.exports = { generateAIChangelog };
