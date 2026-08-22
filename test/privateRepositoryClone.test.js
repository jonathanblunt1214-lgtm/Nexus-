const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { authenticatedGitEnvironment } = require('../githubGitAuth');

test('GitHub clone authentication is transient and scoped to GitHub HTTPS', () => {
  const env = authenticatedGitEnvironment('https://github.com/example/private-repo', 'secret-token', { PATH: 'test' });
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.match(env.GIT_CONFIG_VALUE_0, /^AUTHORIZATION: basic /);
  assert.doesNotMatch(env.GIT_CONFIG_VALUE_0, /secret-token/);
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  const unrelated = authenticatedGitEnvironment('https://gitlab.com/example/repo.git', 'secret-token', {});
  assert.equal(unrelated.GIT_CONFIG_VALUE_0, undefined);
});

test('private repository picker uses connected GitHub results without exposing credentials', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer.js'), 'utf8');
  const main = fs.readFileSync(require.resolve('../main.js'), 'utf8');
  assert.match(html, /Choose from GitHub/);
  assert.match(renderer, /repo\.private.*Private/);
  assert.match(renderer, /window\.nexus\.githubListRepos\(\)/);
  assert.match(main, /githubToken: getGithubToken\(\)/);
  assert.doesNotMatch(renderer, /githubToken/);
});
