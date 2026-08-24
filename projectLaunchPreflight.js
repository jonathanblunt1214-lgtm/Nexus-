const fs = require('fs');
const path = require('path');

function readPackage(folder) {
  const file = path.join(folder, 'package.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function npmScriptForCommand(command) {
  const match = String(command || '').trim().match(/^npm(?:\.cmd)?\s+(?:run\s+)?([a-zA-Z0-9:_-]+)(?:\s+--.*)?$/);
  return match ? match[1] : null;
}

function referencedNodeEntrypoints(script) {
  const entries = [];
  const pattern = /(?:^|&&|\|\||;)\s*(?:node|tsx|ts-node)\s+(?:--[a-zA-Z0-9_-]+\s+)*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
  let match;
  while ((match = pattern.exec(String(script || '')))) entries.push(match[1] || match[2] || match[3]);
  return entries;
}

function referencedLocalExecutables(script) {
  const ignored = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'echo', 'set', 'export']);
  return String(script || '').split(/&&|\|\||;/)
    .map((part) => part.trim().match(/^([a-zA-Z0-9_.-]+)/)?.[1])
    .filter((name) => name && !ignored.has(name.toLowerCase()));
}

function safeProjectFile(folder, relativePath) {
  const root = path.resolve(folder);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

function planProjectLaunch(folder, command) {
  const pkg = readPackage(folder);
  if (!pkg) return { ok: true, packageProject: false, actions: [], missingBefore: [], expectedAfter: [] };

  const scriptName = npmScriptForCommand(command);
  const script = scriptName ? pkg.scripts?.[scriptName] : String(command || '');
  const expectedAfter = referencedNodeEntrypoints(script)
    .map((entry) => ({ entry, file: safeProjectFile(folder, entry) }))
    .filter((item) => item.file);
  const missingBefore = expectedAfter.filter((item) => !fs.existsSync(item.file));
  const hasDependencies = Object.keys(pkg.dependencies || {}).length > 0 || Object.keys(pkg.devDependencies || {}).length > 0;
  const missingExecutables = referencedLocalExecutables(script).filter((name) =>
    !fs.existsSync(path.join(folder, 'node_modules', '.bin', name)) &&
    !fs.existsSync(path.join(folder, 'node_modules', '.bin', `${name}.cmd`))
  );
  const actions = [];

  const buildIsRequired = missingBefore.length && pkg.scripts?.build && scriptName !== 'build';
  if (hasDependencies && (!fs.existsSync(path.join(folder, 'node_modules')) || missingExecutables.length || buildIsRequired)) {
    actions.push({ type: 'install', args: fs.existsSync(path.join(folder, 'package-lock.json')) ? ['ci'] : ['install'] });
  }
  if (buildIsRequired) {
    actions.push({ type: 'build', args: ['run', 'build'] });
  }

  return { ok: true, packageProject: true, scriptName, script, actions, missingBefore, missingExecutables, expectedAfter };
}

function verifyProjectLaunchPlan(plan) {
  const stillMissing = (plan.expectedAfter || []).filter((item) => !fs.existsSync(item.file));
  if (stillMissing.length) {
    return {
      ok: false,
      error: `The start command requires ${stillMissing.map((item) => item.entry).join(', ')}, but the file is still missing after project preparation. Check the package.json build script and its output path.`,
    };
  }
  return { ok: true };
}

module.exports = { npmScriptForCommand, referencedNodeEntrypoints, referencedLocalExecutables, planProjectLaunch, verifyProjectLaunchPlan };
