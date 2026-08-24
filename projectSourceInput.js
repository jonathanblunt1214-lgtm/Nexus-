function isGitUrl(input) {
  if (typeof input !== 'string') return false;
  const trimmed = input.trim();
  return (
    /^https?:\/\/.+\.git$/i.test(trimmed) ||
    /^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/?$/i.test(trimmed) ||
    /^(www\.)?github\.com\/[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*\/?$/i.test(trimmed) ||
    /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/i.test(trimmed) ||
    /^git@.+:.+\.git$/i.test(trimmed)
  );
}

function normalizeGitUrl(input) {
  const trimmed = String(input || '').trim();
  if (/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/i.test(trimmed)) return `https://github.com/${trimmed}`;
  if (/^(www\.)?github\.com\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function repoNameFromUrl(url) {
  const cleaned = url.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const parts = cleaned.split('/');
  const name = parts[parts.length - 1] || 'nexus-project';
  return name.replace(/[^a-zA-Z0-9._-]/g, '-');
}

module.exports = { isGitUrl, normalizeGitUrl, repoNameFromUrl };
