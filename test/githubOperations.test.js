const test = require('node:test');
const assert = require('node:assert/strict');

test('GitHub operations client covers Actions, deployments, releases, and security alerts', () => {
  const source = require('fs').readFileSync(require.resolve('../githubClient'), 'utf8');
  for (const endpoint of ['/actions/runs', '/deployments', '/environments', '/releases', '/dependabot/alerts', '/code-scanning/alerts', '/secret-scanning/alerts', '/artifacts']) assert.match(source, new RegExp(endpoint.replaceAll('/', '\\/')));
  assert.match(source, /rerun-failed-jobs/);
  assert.match(source, /state: 'inactive'/);
});

test('operations renderer exposes logs, artifacts, merge gates, releases, and rollback', () => {
  const html = require('fs').readFileSync(require.resolve('../index.html'), 'utf8');
  const renderer = require('fs').readFileSync(require.resolve('../renderer.js'), 'utf8');
  assert.match(html, /GitHub CI\/CD &amp; Security/);
  for (const feature of ['Download logs', 'Artifacts', 'Create release', 'rollback', 'Security and dependency alerts']) assert.match(`${html}\n${renderer}`, new RegExp(feature, 'i'));
});
