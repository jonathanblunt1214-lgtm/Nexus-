const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SHARED_FILE = 'nexus.project.json';
const LOCAL_FILE = 'nexus.project.local.json';
const ALLOWED_KEYS = new Set(['schemaVersion', 'name', 'commands', 'services', 'deployments', 'environment', 'requiredTools', 'setup', 'debug', 'remote']);

function configPath(folder, local = false) { return path.join(path.resolve(folder), local ? LOCAL_FILE : SHARED_FILE); }
function readJson(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; }
function merge(base, override) {
  const result = { ...base, ...override };
  for (const key of ['commands', 'services', 'deployments', 'environment', 'debug', 'remote']) result[key] = { ...(base[key] || {}), ...(override[key] || {}) };
  if (override.requiredTools === undefined) result.requiredTools = base.requiredTools || [];
  if (override.setup === undefined) result.setup = base.setup || [];
  return result;
}
function validate(config, { shared = true } = {}) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { ok: false, errors: ['Configuration must be an object.'] };
  if (shared && config.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  for (const key of Object.keys(config)) if (!ALLOWED_KEYS.has(key)) errors.push(`Unknown field: ${key}`);
  for (const [name, spec] of Object.entries(config.environment || {})) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) errors.push(`Invalid environment variable name: ${name}`);
    if (!spec || typeof spec !== 'object') errors.push(`Environment ${name} must define a schema.`);
    if (shared && spec && Object.hasOwn(spec, 'value')) errors.push(`Shared environment ${name} cannot contain a value; use ${LOCAL_FILE} or encrypted secrets.`);
    if (spec?.secret && Object.hasOwn(spec, 'default')) errors.push(`Secret environment ${name} cannot have a shared default.`);
  }
  for (const [index, step] of (config.setup || []).entries()) {
    if (!step || typeof step.command !== 'string' || !/^[A-Za-z0-9._-]+$/.test(step.command) || !Array.isArray(step.args || [])) errors.push(`setup[${index}] must use a command name and argument array.`);
  }
  for (const [index, tool] of (config.requiredTools || []).entries()) if (!tool || typeof tool.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(tool.name)) errors.push(`requiredTools[${index}] has an invalid name.`);
  const remote = config.remote || {};
  if (remote.devContainer && typeof remote.devContainer !== 'string') errors.push('remote.devContainer must be a path.');
  if (remote.wslDistribution && typeof remote.wslDistribution !== 'string') errors.push('remote.wslDistribution must be a distribution name.');
  return { ok: errors.length === 0, errors };
}
function load(folder) {
  try {
    const shared = readJson(configPath(folder));
    const local = readJson(configPath(folder, true));
    const sharedValidation = validate(shared, { shared: true });
    const localValidation = validate(local, { shared: false });
    return { ok: sharedValidation.ok && localValidation.ok, shared, local, effective: merge(shared, local), errors: [...sharedValidation.errors, ...localValidation.errors], files: { shared: configPath(folder), local: configPath(folder, true) } };
  } catch (error) { return { ok: false, errors: [error.message] }; }
}
function save(folder, config, { local = false } = {}) {
  const result = validate(config, { shared: !local });
  if (!result.ok) return result;
  fs.writeFileSync(configPath(folder, local), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  if (!local) ensureLocalIgnored(folder);
  return { ok: true, path: configPath(folder, local) };
}
function ensureLocalIgnored(folder) {
  const ignore = path.join(folder, '.gitignore');
  const content = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
  if (!content.split(/\r?\n/).includes(LOCAL_FILE)) fs.appendFileSync(ignore, `${content && !content.endsWith('\n') ? '\n' : ''}${LOCAL_FILE}\n`);
}
function findTool(name) {
  return new Promise((resolve) => execFile(process.platform === 'win32' ? 'where.exe' : 'which', [name], { windowsHide: true }, (error, stdout) => resolve({ name, available: !error, path: error ? null : String(stdout).split(/\r?\n/)[0] })));
}
async function inspect(folder) {
  const result = load(folder);
  if (!result.effective) return result;
  const tools = await Promise.all((result.effective.requiredTools || []).map((tool) => findTool(tool.name)));
  const environment = Object.entries(result.effective.environment || {}).map(([name, spec]) => ({ name, required: Boolean(spec.required), secret: Boolean(spec.secret), present: process.env[name] !== undefined || Object.hasOwn(spec, 'value'), description: spec.description || '' }));
  return { ...result, tools, environment };
}
function runSetup(folder, index) {
  const result = load(folder);
  if (!result.ok) return Promise.resolve({ ok: false, error: result.errors.join('\n') });
  const step = result.effective.setup?.[index];
  if (!step) return Promise.resolve({ ok: false, error: 'Unknown setup step.' });
  return new Promise((resolve) => execFile(step.command, step.args || [], { cwd: folder, windowsHide: true, timeout: 10 * 60_000, env: { ...process.env } }, (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout || ''}${stderr || ''}`, error: error ? error.message : null })));
}

module.exports = { SHARED_FILE, LOCAL_FILE, merge, validate, load, save, inspect, runSetup, ensureLocalIgnored };
