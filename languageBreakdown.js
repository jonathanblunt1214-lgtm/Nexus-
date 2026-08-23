// languageBreakdown.js
// Main-process module: computes a real per-language breakdown for a project
// folder - the same idea as GitHub's repository "Languages" bar. Walks the
// real files on disk and sums actual byte sizes per language (never line
// counts, never a guess) - a file that isn't there contributes zero bytes,
// a 40KB file contributes exactly 40KB. Read-only, never writes anything.
//
// Excludes dependency/build directories (node_modules, dist, .git, etc.) and
// common machine-generated files (lockfiles, .min.js, source maps, .d.ts,
// *.generated.*) so the result reflects code someone actually wrote, the
// same distinction GitHub's own Linguist makes when it computes this bar.

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage',
  '.venv', 'venv', '__pycache__', '.cache', '.parcel-cache', 'vendor',
  'target', 'bin', 'obj', '.gradle', '.idea', '.vscode', '.dart_tool',
  '.generated', '.turbo', '.svelte-kit',
]);

// Lockfiles and other machine-generated manifests - GitHub's Linguist also
// excludes these from language stats by default since no one "wrote" them.
const SKIP_FILENAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
  'gemfile.lock', 'cargo.lock', 'poetry.lock', 'pipfile.lock',
]);

const SKIP_FILE_SUFFIXES = ['.min.js', '.min.css', '.map', '.generated.ts', '.generated.js', '.generated.tsx', '.d.ts'];

const MAX_FILES_SCANNED = 20_000;
const MAX_FILE_SIZE = 5_000_000; // skip absurdly large single files (bundles, data dumps) - not source someone hand-wrote
const MINOR_LANGUAGE_THRESHOLD_PERCENT = 1.0; // languages below this get folded into "Other" when there's more than one

// Extension -> { name, color }. Colors are GitHub Linguist's actual published
// colors (github-linguist/linguist languages.yml) for the languages Nexus is
// realistically going to encounter, so the bar/legend match a real GitHub
// repo page rather than an arbitrary palette.
const LANGUAGE_MAP = {
  '.ts': { name: 'TypeScript', color: '#3178c6' },
  '.tsx': { name: 'TypeScript', color: '#3178c6' },
  '.mts': { name: 'TypeScript', color: '#3178c6' },
  '.cts': { name: 'TypeScript', color: '#3178c6' },
  '.js': { name: 'JavaScript', color: '#f1e05a' },
  '.jsx': { name: 'JavaScript', color: '#f1e05a' },
  '.mjs': { name: 'JavaScript', color: '#f1e05a' },
  '.cjs': { name: 'JavaScript', color: '#f1e05a' },
  '.html': { name: 'HTML', color: '#e34c26' },
  '.htm': { name: 'HTML', color: '#e34c26' },
  '.css': { name: 'CSS', color: '#563d7c' },
  '.scss': { name: 'SCSS', color: '#c6538c' },
  '.sass': { name: 'Sass', color: '#a53b70' },
  '.less': { name: 'Less', color: '#1d365d' },
  '.json': { name: 'JSON', color: '#292929' },
  '.jsonc': { name: 'JSON', color: '#292929' },
  '.py': { name: 'Python', color: '#3572A5' },
  '.rb': { name: 'Ruby', color: '#701516' },
  '.go': { name: 'Go', color: '#00ADD8' },
  '.rs': { name: 'Rust', color: '#dea584' },
  '.java': { name: 'Java', color: '#b07219' },
  '.kt': { name: 'Kotlin', color: '#A97BFF' },
  '.kts': { name: 'Kotlin', color: '#A97BFF' },
  '.swift': { name: 'Swift', color: '#F05138' },
  '.m': { name: 'Objective-C', color: '#438eff' },
  '.mm': { name: 'Objective-C++', color: '#6866fb' },
  '.c': { name: 'C', color: '#555555' },
  '.h': { name: 'C', color: '#555555' },
  '.cpp': { name: 'C++', color: '#f34b7d' },
  '.cc': { name: 'C++', color: '#f34b7d' },
  '.hpp': { name: 'C++', color: '#f34b7d' },
  '.cs': { name: 'C#', color: '#178600' },
  '.php': { name: 'PHP', color: '#4F5D95' },
  '.sh': { name: 'Shell', color: '#89e051' },
  '.bash': { name: 'Shell', color: '#89e051' },
  '.ps1': { name: 'PowerShell', color: '#012456' },
  '.bat': { name: 'Batchfile', color: '#C1F12E' },
  '.yml': { name: 'YAML', color: '#cb171e' },
  '.yaml': { name: 'YAML', color: '#cb171e' },
  '.md': { name: 'Markdown', color: '#083fa1' },
  '.mdx': { name: 'MDX', color: '#fcb32c' },
  '.sql': { name: 'SQL', color: '#e38c00' },
  '.dart': { name: 'Dart', color: '#00B4AB' },
  '.vue': { name: 'Vue', color: '#41b883' },
  '.svelte': { name: 'Svelte', color: '#ff3e00' },
  '.xml': { name: 'XML', color: '#0060ac' },
  '.graphql': { name: 'GraphQL', color: '#e10098' },
  '.lua': { name: 'Lua', color: '#000080' },
  '.r': { name: 'R', color: '#198CE7' },
  '.scala': { name: 'Scala', color: '#c22d40' },
  '.ex': { name: 'Elixir', color: '#6e4a7e' },
  '.exs': { name: 'Elixir', color: '#6e4a7e' },
  '.elm': { name: 'Elm', color: '#60B5CC' },
  '.pl': { name: 'Perl', color: '#0298c3' },
  '.toml': { name: 'TOML', color: '#9c4221' },
};

const DOCKERFILE_LANG = { name: 'Dockerfile', color: '#384d54' };
const OTHER_COLOR = '#8b8b8b';

function shouldSkipFile(name) {
  if (SKIP_FILENAMES.has(name.toLowerCase())) return true;
  const lower = name.toLowerCase();
  return SKIP_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function walk(dir, out) {
  if (out.length >= MAX_FILES_SCANNED) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES_SCANNED) return;
    if (entry.name.startsWith('.')) continue; // dotfiles/dotdirs excluded, same convention Linguist and Nexus's other file walkers use
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile()) {
      if (shouldSkipFile(entry.name)) continue;
      out.push(full);
    }
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function getLanguageBreakdown(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) {
    return { ok: false, error: 'Project folder not found.' };
  }

  const files = [];
  walk(projectPath, files);

  const byLanguage = new Map(); // name -> { bytes, files, color }
  let classifiedBytes = 0;
  let filesClassified = 0;
  let filesSkippedTooLarge = 0;

  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > MAX_FILE_SIZE) { filesSkippedTooLarge += 1; continue; }
    if (stat.size === 0) continue; // empty files contribute zero real bytes either way

    const base = path.basename(file);
    const ext = path.extname(file).toLowerCase();
    const lang = base.toLowerCase() === 'dockerfile' ? DOCKERFILE_LANG : LANGUAGE_MAP[ext];
    if (!lang) continue; // unrecognized extension: not counted as source, not fabricated as "Other" either

    const entry = byLanguage.get(lang.name) || { bytes: 0, files: 0, color: lang.color };
    entry.bytes += stat.size;
    entry.files += 1;
    byLanguage.set(lang.name, entry);
    classifiedBytes += stat.size;
    filesClassified += 1;
  }

  if (classifiedBytes === 0) {
    return {
      ok: true,
      hasData: false,
      totalBytes: 0,
      filesScanned: files.length,
      filesClassified: 0,
      languages: [],
      note: files.length > 0
        ? 'No recognized source-code file extensions were found in this project.'
        : 'No files found to scan.',
    };
  }

  let languages = Array.from(byLanguage.entries())
    .map(([name, data]) => ({
      name,
      color: data.color,
      bytes: data.bytes,
      files: data.files,
      percent: round1((data.bytes / classifiedBytes) * 100),
    }))
    .sort((a, b) => b.bytes - a.bytes);

  // Fold minor languages into a real "Other" bucket, the same way GitHub's
  // own Languages list does when a repo has several small ones - the bucket
  // is a genuine sum of real bytes from real files, just grouped under one
  // label instead of listing each tiny language separately.
  const major = languages.filter((l) => l.percent >= MINOR_LANGUAGE_THRESHOLD_PERCENT);
  const minor = languages.filter((l) => l.percent < MINOR_LANGUAGE_THRESHOLD_PERCENT);
  if (minor.length > 1) {
    const otherBytes = minor.reduce((sum, l) => sum + l.bytes, 0);
    const otherFiles = minor.reduce((sum, l) => sum + l.files, 0);
    languages = [
      ...major,
      {
        name: 'Other',
        color: OTHER_COLOR,
        bytes: otherBytes,
        files: otherFiles,
        percent: round1((otherBytes / classifiedBytes) * 100),
        combinedLanguages: minor.map((l) => l.name),
      },
    ];
  }
  languages.sort((a, b) => b.bytes - a.bytes);

  // Independently-rounded percentages rarely sum to exactly 100.0 - correct
  // the drift on the largest bucket only, so the displayed numbers always
  // add up, without touching the real byte counts they were computed from.
  const roundedSum = round1(languages.reduce((sum, l) => sum + l.percent, 0));
  const drift = round1(100 - roundedSum);
  if (Math.abs(drift) >= 0.1 && languages.length > 0) {
    languages[0] = { ...languages[0], percent: round1(languages[0].percent + drift) };
  }

  return {
    ok: true,
    hasData: true,
    totalBytes: classifiedBytes,
    filesScanned: files.length,
    filesClassified,
    filesSkippedTooLarge,
    languages,
  };
}

module.exports = { getLanguageBreakdown, LANGUAGE_MAP };
