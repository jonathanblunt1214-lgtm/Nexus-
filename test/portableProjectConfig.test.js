const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../portableProjectConfig');

test('shared project configuration rejects secrets and unsafe setup commands', () => {
  assert.equal(config.validate({ schemaVersion: 1, environment: { TOKEN: { secret: true, value: 'nope' } } }).ok, false);
  assert.equal(config.validate({ schemaVersion: 1, setup: [{ command: 'npm && bad', args: [] }] }).ok, false);
  assert.equal(config.validate({ schemaVersion: 1, setup: [{ command: 'npm', args: ['ci'] }] }).ok, true);
});

test('portable configuration merges local overrides and ignores their file', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-config-'));
  try {
    assert.equal(config.save(folder, { schemaVersion: 1, commands: { dev: 'npm run dev' }, environment: { API_URL: { required: true } }, requiredTools: [], setup: [] }).ok, true);
    assert.equal(config.save(folder, { commands: { dev: 'npm run local' }, environment: { API_URL: { value: 'http://localhost' } } }, { local: true }).ok, true);
    const loaded = config.load(folder);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.effective.commands.dev, 'npm run local');
    assert.equal(loaded.effective.environment.API_URL.value, 'http://localhost');
    assert.match(fs.readFileSync(path.join(folder, '.gitignore'), 'utf8'), /nexus\.project\.local\.json/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('remote environment declarations support Dev Containers and WSL', () => {
  const result = config.validate({ schemaVersion: 1, remote: { devContainer: '.devcontainer/devcontainer.json', wslDistribution: 'Ubuntu-24.04' } });
  assert.equal(result.ok, true);
});
