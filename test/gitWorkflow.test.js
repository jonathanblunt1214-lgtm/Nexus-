const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const workflow = require('../gitWorkflow');

async function repo() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-git-workflow-'));
  await workflow.git(folder, ['init', '-b', 'main']);
  await workflow.git(folder, ['config', 'user.email', 'nexus@example.test']);
  await workflow.git(folder, ['config', 'user.name', 'Nexus Test']);
  fs.writeFileSync(path.join(folder, 'app.js'), 'const value = 1;\n');
  await workflow.git(folder, ['add', '.']);
  await workflow.git(folder, ['commit', '-m', 'initial']);
  return folder;
}

test('workflow status separates staged and unstaged files', async (t) => {
  const folder = await repo();
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, 'app.js'), 'const value = 2;\n');
  fs.writeFileSync(path.join(folder, 'new.js'), 'export {};\n');
  await workflow.stagePaths(folder, ['new.js']);
  let status = await workflow.getWorkflowStatus(folder);
  assert.equal(status.ok, true);
  assert.equal(status.files.find((f) => f.file === 'new.js').staged, true);
  assert.equal(status.files.find((f) => f.file === 'app.js').unstaged, true);
  await workflow.unstagePaths(folder, ['new.js']);
  status = await workflow.getWorkflowStatus(folder);
  assert.equal(status.files.find((f) => f.file === 'new.js').untracked, true);
});

test('branch switching, stashes, and history actions are constrained', async (t) => {
  const folder = await repo();
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  await workflow.git(folder, ['branch', 'feature']);
  assert.equal((await workflow.switchBranch(folder, 'feature')).ok, true);
  assert.equal((await workflow.switchBranch(folder, '../bad branch')).ok, false);
  fs.writeFileSync(path.join(folder, 'app.js'), 'const value = 3;\n');
  assert.equal((await workflow.stashAction(folder, 'create', null, 'work')).ok, true);
  assert.equal((await workflow.listStashes(folder)).stashes.length, 1);
  assert.equal((await workflow.stashAction(folder, 'drop', 'bad-ref')).ok, false);
  assert.equal((await workflow.historyAction(folder, 'revert', 'not-a-hash')).ok, false);
});

test('GitHub remotes are parsed without accepting unrelated hosts', () => {
  assert.deepEqual(workflow.parseGitHubRemote('git@github.com:owner/repo.git'), { owner: 'owner', repo: 'repo' });
  assert.deepEqual(workflow.parseGitHubRemote('https://github.com/owner/repo'), { owner: 'owner', repo: 'repo' });
  assert.equal(workflow.parseGitHubRemote('https://example.com/owner/repo.git'), null);
});
