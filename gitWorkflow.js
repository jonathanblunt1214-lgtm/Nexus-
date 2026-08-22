const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function git(folder, args, options = {}) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: folder, timeout: options.timeout || 60_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      // Porcelain status uses a meaningful leading space for unstaged files.
      // Remove only line endings at the right edge so its two-column state is
      // preserved exactly.
      const output = `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trimEnd();
      resolve({ ok: !error, output, error: error ? output || error.message : null, code: error?.code ?? 0 });
    });
  });
}

function safeRelative(folder, relativePath) {
  const root = path.resolve(folder);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Git path escapes the workspace.');
  return target;
}

function parsePorcelain(output) {
  const entries = output.split('\0').filter(Boolean);
  const files = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    let source = null;
    // In -z mode rename/copy records store the destination followed by a
    // second NUL-delimited source path. Keep both without mistaking the source
    // for another status record.
    if (/[RC]/.test(status) && entries[index + 1]) source = entries[++index];
    files.push({ file, source, staged: status[0] !== ' ' && status[0] !== '?', unstaged: status[1] !== ' ', untracked: status === '??', status });
  }
  return files;
}

async function getWorkflowStatus(folder) {
  const [branch, status, upstream] = await Promise.all([
    git(folder, ['branch', '--show-current']),
    git(folder, ['status', '--porcelain=v1', '-z']),
    git(folder, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
  ]);
  if (!branch.ok || !status.ok) return { ok: false, error: branch.error || status.error || 'Not a Git repository.' };
  let ahead = 0;
  let behind = 0;
  if (upstream.ok) {
    const counts = await git(folder, ['rev-list', '--left-right', '--count', `HEAD...${upstream.output}`]);
    if (counts.ok) [ahead, behind] = counts.output.split(/\s+/).map((value) => Number.parseInt(value, 10) || 0);
  }
  const conflicts = await git(folder, ['diff', '--name-only', '--diff-filter=U']);
  return {
    ok: true, branch: branch.output || '(detached)', upstream: upstream.ok ? upstream.output : null,
    ahead, behind, files: parsePorcelain(status.output), conflicts: conflicts.ok ? conflicts.output.split('\n').filter(Boolean) : [],
  };
}

async function stagePaths(folder, paths) {
  for (const item of paths) safeRelative(folder, item);
  return git(folder, ['add', '--', ...paths]);
}

async function unstagePaths(folder, paths) {
  for (const item of paths) safeRelative(folder, item);
  return git(folder, ['restore', '--staged', '--', ...paths]);
}

async function listBranches(folder) {
  const result = await git(folder, ['branch', '--format=%(refname:short)|||%(HEAD)']);
  if (!result.ok) return result;
  return { ok: true, branches: result.output.split('\n').filter(Boolean).map((line) => {
    const [name, head] = line.split('|||');
    return { name, current: head === '*' };
  }) };
}

async function switchBranch(folder, branch) {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch || '')) return { ok: false, error: 'Invalid branch name.' };
  return git(folder, ['switch', branch]);
}

async function listStashes(folder) {
  const result = await git(folder, ['stash', 'list', '--format=%gd|||%H|||%s|||%ci']);
  if (!result.ok) return result;
  return { ok: true, stashes: result.output.split('\n').filter(Boolean).map((line) => {
    const [ref, hash, message, date] = line.split('|||');
    return { ref, hash, message, date };
  }) };
}

async function stashAction(folder, action, ref, message) {
  if (action === 'create') return git(folder, ['stash', 'push', '--include-untracked', '-m', String(message || 'Nexus stash').slice(0, 200)]);
  if (!/^stash@\{\d+\}$/.test(ref || '')) return { ok: false, error: 'Invalid stash reference.' };
  if (!['apply', 'pop', 'drop'].includes(action)) return { ok: false, error: 'Unsupported stash action.' };
  return git(folder, ['stash', action, ref]);
}

async function historyAction(folder, action, hash) {
  if (!/^[0-9a-f]{7,40}$/i.test(hash || '')) return { ok: false, error: 'Invalid commit hash.' };
  if (action === 'cherry-pick') return git(folder, ['cherry-pick', hash]);
  if (action === 'revert') return git(folder, ['revert', '--no-edit', hash]);
  return { ok: false, error: 'Unsupported history action.' };
}

async function conflictDetails(folder, relativePath) {
  const target = safeRelative(folder, relativePath);
  const readStage = async (stage) => {
    const result = await git(folder, ['show', `:${stage}:${relativePath}`]);
    return result.ok ? result.output : '';
  };
  return { ok: true, file: relativePath, current: fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '', base: await readStage(1), ours: await readStage(2), theirs: await readStage(3) };
}

async function resolveConflict(folder, relativePath, content) {
  const target = safeRelative(folder, relativePath);
  fs.writeFileSync(target, String(content), 'utf8');
  return git(folder, ['add', '--', relativePath]);
}

async function abortOperation(folder, action) {
  const commands = { merge: ['merge', '--abort'], rebase: ['rebase', '--abort'], 'cherry-pick': ['cherry-pick', '--abort'], revert: ['revert', '--abort'] };
  return commands[action] ? git(folder, commands[action]) : { ok: false, error: 'Unsupported abort operation.' };
}

function parseGitHubRemote(remote) {
  const match = String(remote || '').match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return match ? { owner: match[1], repo: match[2] } : null;
}

module.exports = { git, parsePorcelain, getWorkflowStatus, stagePaths, unstagePaths, listBranches, switchBranch, listStashes, stashAction, historyAction, conflictDetails, resolveConflict, abortOperation, parseGitHubRemote };
