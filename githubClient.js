// githubClient.js
// Thin GitHub REST API v3 client used by the github-* IPC handlers in
// main.js. Every function takes the caller's token explicitly (it does not
// read config/storage itself) so it stays a plain, testable Node module
// with no Electron dependency. Uses the platform's global fetch (Node 18+ /
// Electron's bundled runtime), the same pattern main.js already uses for
// Gemini/NIM calls.

const API_BASE = 'https://api.github.com';

async function githubRequest(token, method, urlPath, body) {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }

  if (!res.ok) {
    const message = (data && (data.message || data.error)) || `GitHub API returned ${res.status}`;
    throw new Error(`${message} (${res.status} ${urlPath})`);
  }
  return data;
}

async function listRepos(token) {
  const repos = await githubRequest(token, 'GET', '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator');
  return repos.map((r) => ({
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    htmlUrl: r.html_url,
    defaultBranch: r.default_branch,
    description: r.description,
    updatedAt: r.updated_at,
  }));
}

async function getFileContent(token, owner, repo, filePath, ref) {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const data = await githubRequest(token, 'GET', `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}${query}`);
  if (Array.isArray(data)) throw new Error(`${filePath} is a directory, not a file.`);
  const content = data.encoding === 'base64' ? Buffer.from(data.content, 'base64').toString('utf8') : data.content;
  return { content, sha: data.sha, path: data.path };
}

async function createOrUpdateFile(token, owner, repo, filePath, content, message, branch, sha) {
  const body = {
    message: message || `Update ${filePath}`,
    content: Buffer.from(content, 'utf8').toString('base64'),
  };
  if (branch) body.branch = branch;
  if (sha) body.sha = sha; // required when overwriting an existing file, omitted when creating a new one
  return githubRequest(token, 'PUT', `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, body);
}

async function createPullRequest(token, owner, repo, title, body, head, base) {
  return githubRequest(token, 'POST', `/repos/${owner}/${repo}/pulls`, { title, body, head, base });
}

async function getPullRequests(token, owner, repo, state = 'open') {
  const prs = await githubRequest(token, 'GET', `/repos/${owner}/${repo}/pulls?state=${encodeURIComponent(state)}&per_page=50`);
  return prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    htmlUrl: pr.html_url,
    head: pr.head?.ref,
    base: pr.base?.ref,
    createdAt: pr.created_at,
  }));
}

async function getPullRequestReview(token, owner, repo, number) {
  const pr = await githubRequest(token, 'GET', `/repos/${owner}/${repo}/pulls/${number}`);
  const [files, reviews, checks] = await Promise.all([
    githubRequest(token, 'GET', `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`),
    githubRequest(token, 'GET', `/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`),
    githubRequest(token, 'GET', `/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`),
  ]);
  return {
    number: pr.number, title: pr.title, body: pr.body, state: pr.state, draft: pr.draft,
    mergeable: pr.mergeable, mergeableState: pr.mergeable_state, head: pr.head.ref, base: pr.base.ref,
    author: pr.user?.login, htmlUrl: pr.html_url,
    files: files.map((file) => ({ filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, patch: file.patch || '' })),
    reviews: reviews.map((review) => ({ author: review.user?.login, state: review.state, body: review.body, submittedAt: review.submitted_at })),
    checks: (checks.check_runs || []).map((check) => ({ name: check.name, status: check.status, conclusion: check.conclusion, htmlUrl: check.html_url })),
  };
}

async function submitPullRequestReview(token, owner, repo, number, body, event) {
  if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event)) throw new Error('Invalid review action.');
  return githubRequest(token, 'POST', `/repos/${owner}/${repo}/pulls/${number}/reviews`, { body, event });
}

async function mergePullRequest(token, owner, repo, number, mergeMethod = 'merge') {
  return githubRequest(token, 'PUT', `/repos/${owner}/${repo}/pulls/${number}/merge`, { merge_method: mergeMethod });
}

async function getBranchProtection(token, owner, repo, branch) {
  try {
    const data = await githubRequest(token, 'GET', `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`);
    return { protected: true, requiredChecks: data.required_status_checks?.contexts || [], enforceAdmins: Boolean(data.enforce_admins?.enabled), reviewsRequired: data.required_pull_request_reviews?.required_approving_review_count || 0 };
  } catch (error) {
    if (/\(404 /.test(error.message)) return { protected: false, requiredChecks: [], enforceAdmins: false, reviewsRequired: 0 };
    throw error;
  }
}

async function createBranch(token, owner, repo, branch, fromBranch) {
  const base = await githubRequest(token, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(fromBranch)}`);
  return githubRequest(token, 'POST', `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: base.object.sha,
  });
}

async function getCommits(token, owner, repo, branch, per_page = 30) {
  const query = new URLSearchParams({ per_page: String(per_page || 30) });
  if (branch) query.set('sha', branch);
  const commits = await githubRequest(token, 'GET', `/repos/${owner}/${repo}/commits?${query.toString()}`);
  return commits.map((c) => ({
    sha: c.sha,
    message: c.commit?.message,
    author: c.commit?.author?.name,
    date: c.commit?.author?.date,
    htmlUrl: c.html_url,
  }));
}

module.exports = {
  listRepos,
  getFileContent,
  createOrUpdateFile,
  createPullRequest,
  getPullRequests,
  getPullRequestReview,
  submitPullRequestReview,
  mergePullRequest,
  getBranchProtection,
  createBranch,
  getCommits,
};
