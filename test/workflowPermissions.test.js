const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// GITHUB_TOKEN scopes GitHub Actions actually recognizes in a workflow's
// `permissions:` block. An unrecognized key here doesn't get rejected with
// a clear error - it can make GitHub fail to resolve the whole workflow
// (including any reusable workflow it calls via `uses:`), which is exactly
// what happened when `administration: read` (a real GitHub App/REST API
// permission name, but not a valid Actions permissions key) was added to
// the-crucible.yml and silently broke every run of it.
const VALID_PERMISSION_KEYS = new Set([
  'actions', 'attestations', 'checks', 'contents', 'deployments', 'id-token',
  'issues', 'discussions', 'packages', 'pages', 'pull-requests',
  'repository-projects', 'security-events', 'statuses',
]);

const workflowsDir = path.join(__dirname, '..', '.github', 'workflows');
const workflowFiles = fs.readdirSync(workflowsDir).filter((file) => file.endsWith('.yml'));

test('every workflow-level permissions key is one GitHub Actions actually recognizes', () => {
  for (const file of workflowFiles) {
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    const match = content.match(/^permissions:\n((?:  [a-z-]+: \w+\n)+)/m);
    if (!match) continue;
    const keys = [...match[1].matchAll(/^  ([a-z-]+):/gm)].map((entry) => entry[1]);
    for (const key of keys) {
      assert.ok(VALID_PERMISSION_KEYS.has(key), `${file} sets an unrecognized permissions key "${key}" - it grants nothing and can break the whole workflow`);
    }
  }
});
