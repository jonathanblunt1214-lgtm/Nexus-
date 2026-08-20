// dependencyAuditor.js
// Main-process module: audits a project's AI-related npm dependencies -
// what's declared in package.json, what's actually installed in
// node_modules, and (best-effort, non-fatal if offline) what the latest
// published version is. Never modifies anything; upgrading is a separate,
// explicit action (see aiUpgradeOrchestrator for the config-level version -
// bumping a dependency itself is left to Nexus's existing npm-update-package
// handler, which this module deliberately does not duplicate).

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const AI_PACKAGE_PATTERN = /genai|generative-ai|anthropic|openai|@xenova|ollama|langchain|firebase/i;
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const REGISTRY_TIMEOUT_MS = 6000;

function getInstalledVersion(projectPath, pkgName) {
  try {
    const pkgJsonPath = path.join(projectPath, 'node_modules', pkgName, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return null;
    const data = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    return data.version || null;
  } catch {
    return null;
  }
}

function getLatestVersion(pkgName) {
  return new Promise((resolve) => {
    execFile(NPM_BIN, ['view', pkgName, 'version'], { timeout: REGISTRY_TIMEOUT_MS }, (error, stdout) => {
      if (error) { resolve(null); return; }
      resolve((stdout || '').trim() || null);
    });
  });
}

/**
 * Audits every AI-related dependency declared in package.json.
 * Network lookups (latest version) are best-effort: if npm can't reach the
 * registry, that field is simply null rather than failing the whole audit.
 */
async function auditAIDependencies(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) return { ok: false, error: 'Folder not found.' };
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return { ok: false, error: 'No package.json in this folder.' };

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return { ok: false, error: 'package.json could not be parsed.' };
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const aiDeps = Object.entries(deps || {}).filter(([name]) => AI_PACKAGE_PATTERN.test(name));

  const results = await Promise.all(aiDeps.map(async ([name, declaredRange]) => {
    const installed = getInstalledVersion(projectPath, name);
    const latest = await getLatestVersion(name);
    return {
      name,
      declaredRange,
      installedVersion: installed,
      latestVersion: latest,
      upToDate: installed && latest ? installed === latest : null,
      installedButNotResolved: !installed,
    };
  }));

  return { ok: true, projectPath, dependencies: results, checkedAt: new Date().toISOString() };
}

module.exports = { auditAIDependencies };
