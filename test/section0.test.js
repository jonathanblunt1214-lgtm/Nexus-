const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeJsonAtomicSync, writeJsonAtomic } = require('../atomicWrite');
const { scanProject } = require('../aiInventory');

test('atomic JSON write replaces the target only after a complete temp write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-atomic-'));
  const target = path.join(dir, 'config.json');

  fs.writeFileSync(target, JSON.stringify({ version: 1 }), 'utf8');
  writeJsonAtomicSync(target, { version: 2, stable: true });

  const result = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.deepEqual(result, { version: 2, stable: true });
  assert.equal(fs.existsSync(`${target}.tmp`), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('atomic JSON write preserves the previous file when rename fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-atomic-fail-'));
  const target = path.join(dir, 'config.json');
  fs.writeFileSync(target, JSON.stringify({ version: 1 }), 'utf8');

  const failingFs = {
    ...fs,
    renameSync() {
      throw new Error('simulated power loss');
    },
  };

  assert.throws(
    () => writeJsonAtomicSync(target, { version: 2 }, { fs: failingFs }),
    /Atomic JSON persistence failed/
  );

  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { version: 1 });
  assert.equal(fs.existsSync(`${target}.tmp`), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('concurrent atomic writes to the same target use isolated temporary files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-atomic-concurrent-'));
  const target = path.join(dir, 'config.json');
  await Promise.all(Array.from({ length:500 }, (_, index) => writeJsonAtomic(target, { index, payload:'x'.repeat(2048) })));
  const result = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.ok(Number.isInteger(result.index));
  assert.equal(result.payload.length, 2048);
  assert.deepEqual(fs.readdirSync(dir), ['config.json']);
  fs.rmSync(dir, { recursive:true, force:true });
});

test('AI inventory scanning runs through the worker and preserves inventory semantics', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-inventory-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'node_modules', 'ignored-package'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: { openai: '^5.0.0', express: '^5.0.0' } }),
    'utf8'
  );
  fs.writeFileSync(path.join(dir, '.env.example'), 'OPENAI_API_KEY=\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'client.js'), "const model = 'gpt-4o-mini';\n", 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'securityPolicy.js'), 'module.exports = {};\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'node_modules', 'ignored-package', 'index.js'), "const x = 'claude-3';\n", 'utf8');

  const inventory = await scanProject(dir);

  assert.equal(inventory.error, undefined);
  assert.ok(inventory.filesScanned >= 3);
  assert.ok(inventory.aiPackages.some((pkg) => pkg.name === 'openai'));
  assert.ok(inventory.apiKeys.some((key) => key.name === 'OPENAI_API_KEY'));
  assert.ok(inventory.models.some((model) => model.type === 'gpt'));
  assert.equal(inventory.models.some((model) => model.type === 'claude'), false);
  assert.ok(inventory.guardrails.some((item) => item.path.endsWith('securityPolicy.js')));

  fs.rmSync(dir, { recursive: true, force: true });
});
