const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const token = process.env.GITHUB_TOKEN || '';
const failedSha = process.env.FAILED_SHA || '';
const attempt = process.env.ATTEMPT || '1';
const endpoint = 'https://models.github.ai/inference/chat/completions';
const model = process.env.NEXUS_REPAIR_MODEL || 'openai/gpt-4.1';
const maxTurns = 18;

if (!token) throw new Error('GITHUB_TOKEN is required for GitHub Models repair.');

function insideRoot(relative) {
  if (!relative || path.isAbsolute(relative)) return null;
  const absolute = path.resolve(root, relative);
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) return null;
  return absolute;
}

function readText(relative, start = 1, end = 400) {
  const absolute = insideRoot(relative);
  if (!absolute || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return `ERROR: cannot read ${relative}`;
  const lines = fs.readFileSync(absolute, 'utf8').split(/\r?\n/);
  const from = Math.max(1, Number(start) || 1);
  const to = Math.min(lines.length, Math.max(from, Number(end) || from + 399));
  return lines.slice(from - 1, to).map((line, index) => `${from + index}: ${line}`).join('\n');
}

function searchText(query, scope = '.') {
  if (!query || query.length > 200) return 'ERROR: invalid search query';
  const base = scope === '.' ? root : insideRoot(scope);
  if (!base || !fs.existsSync(base)) return `ERROR: invalid search scope ${scope}`;
  const hits = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'release', '.the-crucible-runtime']);
  function walk(current) {
    if (hits.length >= 80) return;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        if (skip.has(entry)) continue;
        walk(path.join(current, entry));
        if (hits.length >= 80) return;
      }
      return;
    }
    if (!stat.isFile() || stat.size > 1024 * 1024) return;
    let text;
    try { text = fs.readFileSync(current, 'utf8'); } catch { return; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes(query)) {
        hits.push(`${path.relative(root, current).replace(/\\/g, '/')}:${i + 1}: ${lines[i].slice(0, 300)}`);
        if (hits.length >= 80) return;
      }
    }
  }
  walk(base);
  return hits.length ? hits.join('\n') : 'NO MATCHES';
}

function replaceExact(relative, oldText, newText) {
  const absolute = insideRoot(relative);
  if (!absolute || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return `ERROR: cannot edit ${relative}`;
  if (relative === 'AGENTS.md' || relative === 'AI-CONFLICTS.json') return `ERROR: autonomous repair may not modify ${relative}`;
  const before = fs.readFileSync(absolute, 'utf8');
  const count = before.split(oldText).length - 1;
  if (count !== 1) return `ERROR: expected exactly one match in ${relative}, found ${count}`;
  fs.writeFileSync(absolute, before.replace(oldText, newText));
  return `UPDATED ${relative}`;
}

function writeText(relative, content) {
  const absolute = insideRoot(relative);
  if (!absolute) return `ERROR: invalid path ${relative}`;
  if (relative === 'AGENTS.md' || relative === 'AI-CONFLICTS.json') return `ERROR: autonomous repair may not modify ${relative}`;
  if (relative.startsWith('.github/workflows/') || relative === '.thecrucible.json') return `ERROR: autonomous model may not directly rewrite governance/gate configuration ${relative}`;
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, String(content));
  return `WROTE ${relative}`;
}

function commandAllowed(command) {
  if (typeof command !== 'string' || command.length > 300) return false;
  if (/[;&|`$<>]/.test(command)) return false;
  return /^(npm run [A-Za-z0-9:_-]+|npm test|node --test [A-Za-z0-9_./*-]+|node scripts\/[A-Za-z0-9_.-]+(?: [A-Za-z0-9_./=-]+)*)$/.test(command);
}

function runCommand(command) {
  if (!commandAllowed(command)) return `ERROR: command not allowed: ${command}`;
  const parts = command.split(/\s+/);
  const result = spawnSync(parts[0], parts.slice(1), { cwd: root, encoding: 'utf8', timeout: 10 * 60 * 1000 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return `exit=${result.status}\n${output.slice(-18000)}`;
}

function gitDiff() {
  const result = spawnSync('git', ['diff', '--', ':!repository-file-manifest.json'], { cwd: root, encoding: 'utf8' });
  return (result.stdout || '').slice(-18000) || 'NO SOURCE DIFF';
}

async function ask(messages) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ model, temperature: 0.1, max_tokens: 5000, messages }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`GitHub Models request failed ${response.status}: ${body.slice(0, 1000)}`);
  const parsed = JSON.parse(body);
  return parsed.choices?.[0]?.message?.content || '';
}

function parseAction(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error(`Model returned non-JSON action: ${text.slice(0, 800)}`);
  }
}

const policy = `You are the autonomous Nexus Development repair agent operating after The Crucible failed.
You are on Development-branch commit ${failedSha}, repair attempt ${attempt}/3. Never commit, push, create branches, touch main, weaken tests/security/governance, alter AGENTS.md or AI-CONFLICTS.json, or change Crucible/workflow configuration to hide a failure. Fix the actual application/test/build root cause. Preserve concurrent work. Use repository evidence, not guesses.

You have exactly these actions, one per response, returned as raw JSON only:
{"action":"read","path":"relative/file","start":1,"end":300}
{"action":"search","query":"literal text","scope":"."}
{"action":"replace","path":"relative/file","old":"exact text","new":"replacement"}
{"action":"write","path":"relative/file","content":"complete content"}
{"action":"run","command":"allowed command"}
{"action":"diff"}
{"action":"done","summary":"what was fixed and verified"}

Prefer read/search/replace over rewriting whole files. Run the narrow failing test after edits, then npm run release:crucible before done. If inventory is stale because of legitimate edits, the enclosing workflow refreshes it after you finish.`;

(async () => {
  const initialFailure = runCommand('npm run release:crucible');
  const messages = [
    { role: 'system', content: policy },
    { role: 'user', content: `Governance excerpts:\nAGENTS.md:\n${readText('AGENTS.md', 1, 180)}\n\nAI-CONFLICTS.json:\n${readText('AI-CONFLICTS.json', 1, 80)}\n\nCurrent Crucible reproduction:\n${initialFailure}` },
  ];
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const content = await ask(messages);
    const action = parseAction(content);
    let result;
    switch (action.action) {
      case 'read': result = readText(action.path, action.start, action.end); break;
      case 'search': result = searchText(action.query, action.scope || '.'); break;
      case 'replace': result = replaceExact(action.path, String(action.old ?? ''), String(action.new ?? '')); break;
      case 'write': result = writeText(action.path, String(action.content ?? '')); break;
      case 'run': result = runCommand(action.command); break;
      case 'diff': result = gitDiff(); break;
      case 'done':
        console.log(`[models-repair] ${action.summary || 'repair completed'}`);
        console.log(gitDiff());
        process.exit(0);
        break;
      default: result = `ERROR: unknown action ${action.action}`;
    }
    console.log(`[models-repair] turn=${turn} action=${action.action}`);
    messages.push({ role: 'assistant', content });
    messages.push({ role: 'user', content: `Tool result:\n${String(result).slice(-20000)}\nChoose the next action.` });
  }
  throw new Error(`GitHub Models repair agent exhausted ${maxTurns} turns without completing.`);
})().catch((error) => {
  console.error(`[models-repair] ${error.stack || error.message}`);
  process.exit(1);
});
