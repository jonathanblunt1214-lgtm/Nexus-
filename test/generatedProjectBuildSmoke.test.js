const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  isSafeGeneratedProjectPath,
  parseGeneratedFiles,
  detectStartCommand,
} = require('../pureLogic');
const {
  planProjectLaunch,
  verifyProjectLaunchPlan,
} = require('../projectLaunchPreflight');

function materializeGeneratedFiles(root, files) {
  for (const file of files) {
    assert.equal(isSafeGeneratedProjectPath(file.relPath), true, `unsafe generated path: ${file.relPath}`);
    const target = path.resolve(root, file.relPath);
    assert.ok(target.startsWith(`${path.resolve(root)}${path.sep}`));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, 'utf8');
  }
}

test('AI project generation rejects paths that can escape the project root', () => {
  const traversal = [
    '===FILE: package.json===',
    '{"scripts":{"start":"node index.js"}}',
    '===END FILE===',
    '===FILE: ../outside.txt===',
    'should never be written',
    '===END FILE===',
  ].join('\n');
  assert.deepEqual(parseGeneratedFiles(traversal), []);

  const windowsEscape = '===FILE: C:\\temp\\outside.txt===\nnope\n===END FILE===';
  assert.deepEqual(parseGeneratedFiles(windowsEscape), []);

  const duplicate = [
    '===FILE: src/App.js===',
    'one',
    '===END FILE===',
    '===FILE: src/app.js===',
    'two',
    '===END FILE===',
  ].join('\n');
  assert.deepEqual(parseGeneratedFiles(duplicate), []);
});

test('representative AI-generated application can be materialized, built, verified, and started', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-generated-project-'));
  try {
    const modelResponse = [
      '===FILE: package.json===',
      JSON.stringify({
        name: 'smoke-stack-style-project',
        private: true,
        scripts: {
          build: 'node build.js',
          start: 'node dist/server.js',
        },
      }, null, 2),
      '===END FILE===',
      '===FILE: build.js===',
      "const fs = require('fs');\nfs.mkdirSync('dist', { recursive: true });\nfs.writeFileSync('dist/server.js', \"console.log('NEXUS_GENERATED_PROJECT_OK');\\n\");",
      '===END FILE===',
      '===FILE: src/app.js===',
      "module.exports = { name: 'Smoke Stack style generated app', healthy: true };",
      '===END FILE===',
      '===FILE: README.md===',
      '# Generated project\nBuilt through the same generated-file and launch-preflight contracts used by Nexus.',
      '===END FILE===',
    ].join('\n');

    const files = parseGeneratedFiles(modelResponse);
    assert.equal(files.length, 4);
    assert.equal(detectStartCommand(files), 'npm start');
    materializeGeneratedFiles(root, files);

    const plan = planProjectLaunch(root, 'npm start');
    assert.equal(plan.packageProject, true);
    assert.deepEqual(plan.actions.map((action) => action.type), ['build']);
    assert.deepEqual(plan.missingBefore.map((item) => item.entry), ['dist/server.js']);

    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const build = spawnSync(npmBin, ['run', 'build'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
    assert.equal(build.status, 0, build.stderr || build.stdout);
    assert.deepEqual(verifyProjectLaunchPlan(plan), { ok: true });

    const start = spawnSync(npmBin, ['start'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
    assert.equal(start.status, 0, start.stderr || start.stdout);
    assert.match(start.stdout, /NEXUS_GENERATED_PROJECT_OK/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
