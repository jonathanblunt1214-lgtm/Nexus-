// githubClient.js
// Main-process module for direct GitHub API interactions

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(app.getPath('userData'), 'nexus-config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function getGitHubToken() {
  const cfg = loadConfig();
  return cfg.githubToken || null;
}

function saveGitHubToken(token) {
  const cfg = loadConfig();
  cfg.githubToken = token;
  saveConfig(cfg);
}

async function githubFetch(endpoint, options = {}) {
  const token = getGitHubToken();
  if (!token) throw new Error('No GitHub token saved. Add one in the Cloud tab.');

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    ...options.headers,
  };

  const res = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const json = JSON.parse(text);
      message = json.message || json.error || text;
    } catch {}
    throw new Error(`GitHub API error (${res.status}): ${message}`);
  }

  return res.json();
}

// --- Repository Operations ---

async function listRepos(options = {}) {
  const { per_page = 100, page = 1, sort = 'updated' } = options;
  return githubFetch(`/user/repos?per_page=${per_page}&page=${page}&sort=${sort}`);
}

async function getRepoContents(owner, repo, path = '', ref = 'main') {
  const url = path 
    ? `/repos/${owner}/${repo}/contents/${path}?ref=${ref}`
    : `/repos/${owner}/${repo}/contents?ref=${ref}`;
  return githubFetch(url);
}

async function getFileContent(owner, repo, filePath, ref = 'main') {
  const data = await githubFetch(`/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`);
  if (data.content && data.encoding === 'base64') {
    return {
      ...data,
      content: Buffer.from(data.content, 'base64').toString('utf8'),
      decoded: true,
    };
  }
  return data;
}

async function createOrUpdateFile(owner, repo, filePath, content, message, branch = 'main', sha = null) {
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
  };
  if (sha) body.sha = sha;

  return githubFetch(`/repos/${owner}/${repo}/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

async function createPullRequest(owner, repo, title, body, head, base = 'main') {
  return githubFetch(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title, body, head, base }),
  });
}

async function getPullRequests(owner, repo, state = 'open') {
  return githubFetch(`/repos/${owner}/${repo}/pulls?state=${state}`);
}

async function getPullRequestDiff(owner, repo, pullNumber) {
  const res = await fetch(`https://github.com/${owner}/${repo}/pull/${pullNumber}.diff`, {
    headers: { 'Authorization': `Bearer ${getGitHubToken()}` },
  });
  if (!res.ok) throw new Error(`Failed to get diff: ${res.status}`);
  return res.text();
}

async function createBranch(owner, repo, branchName, fromBranch = 'main') {
  const refData = await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${fromBranch}`);
  const sha = refData.object.sha;

  return githubFetch(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha,
    }),
  });
}

async function getCommits(owner, repo, branch = 'main', per_page = 30) {
  return githubFetch(`/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${per_page}`);
}

module.exports = {
  getGitHubToken,
  saveGitHubToken,
  listRepos,
  getRepoContents,
  getFileContent,
  createOrUpdateFile,
  createPullRequest,
  getPullRequests,
  getPullRequestDiff,
  createBranch,
  getCommits,
  githubFetch,
};