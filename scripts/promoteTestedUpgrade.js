const { execFileSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
const required = ['verify', 'dependency-and-release-audit', 'windows-package-smoke', ...['ubuntu-latest','windows-latest','macos-latest'].flatMap(os => [20,22,24].map(node => `Tests ${os} / Node ${node}`))];

function git(args, options = {}) { const result = execFileSync('git', args, { cwd:root, encoding:'utf8', stdio:options.inherit ? 'inherit' : undefined }); return typeof result === 'string' ? result.trim() : ''; }
async function api(endpoint, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${endpoint}`, { ...options, headers:{ Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json', 'User-Agent':'Nexus-Promotion-Retry', 'X-GitHub-Api-Version':'2022-11-28', ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}
async function checkState(sha) {
  const data = await api(`/commits/${sha}/check-runs?per_page=100`);
  const successful = new Set(data.check_runs.filter(check => check.conclusion === 'success').map(check => check.name));
  return required.filter(name => !successful.has(name));
}
async function dispatch(workflow) { await api(`/actions/workflows/${workflow}/dispatches`, { method:'POST', body:JSON.stringify({ ref:'upgrade/nexus-overhaul' }), headers:{ 'Content-Type':'application/json' } }); }
async function waitForChecks(sha, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const missing = await checkState(sha);
    if (!missing.length) return;
    if (attempt === attempts - 1) throw new Error(`Promotion retry exhausted. Upgrade remains unpromoted. Missing checks: ${missing.join(', ')}`);
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
}
async function validateLocally() {
  for (const [command, args] of [[process.execPath,['scripts/remediateUpgradeForPromotion.js']],[process.execPath,['scripts/verifyRepositoryInventory.js']],[process.execPath,['--test']],[process.execPath,['scripts/verifyArchitecture.js']],[process.execPath,['scripts/releaseAudit.js']],[process.execPath,['scripts/releaseStressGate.js']]]) execFileSync(command, args, { cwd:root, stdio:'inherit' });
}
async function main() {
  if (!repository || !token) throw new Error('GitHub promotion credentials are unavailable.');
  git(['fetch', 'origin', 'main', 'upgrade/nexus-overhaul']);
  let mainSha = git(['rev-parse', 'origin/main']);
  let upgradeSha = git(['rev-parse', 'origin/upgrade/nexus-overhaul']);
  try { execFileSync('git', ['merge-base', '--is-ancestor', mainSha, upgradeSha], { cwd:root }); }
  catch { throw new Error('Branches diverged. Upgrade was preserved; automatic rewriting will not discard either history.'); }
  let missing = await checkState(upgradeSha);
  if (missing.length) {
    console.log(`Promotion checks need remediation/retry: ${missing.join(', ')}`);
    await validateLocally();
    if (git(['status', '--porcelain'])) {
      git(['config', 'user.name', 'github-actions[bot]']);
      git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
      git(['add', '-A']);
      git(['commit', '-m', 'Apply deterministic promotion repairs']);
      git(['push', 'origin', 'HEAD:upgrade/nexus-overhaul'], { inherit:true });
      upgradeSha = git(['rev-parse', 'HEAD']);
    }
    await Promise.all([dispatch('section0-stability.yml'), dispatch('release-audit.yml')]);
    await waitForChecks(upgradeSha);
  }
  const currentUpgrade = git(['ls-remote', 'origin', 'refs/heads/upgrade/nexus-overhaul']).split(/\s/)[0];
  if (currentUpgrade !== upgradeSha) throw new Error('Upgrade moved during retry. No rejection or overwrite occurred; run promotion again for the newer commit.');
  git(['push', 'origin', `${upgradeSha}:refs/heads/main`], { inherit:true });
  console.log(`Promoted repaired and validated upgrade commit ${upgradeSha}.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
