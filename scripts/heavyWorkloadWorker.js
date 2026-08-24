const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { writeJsonAtomic } = require('../atomicWrite');
const { indexWorkspace } = require('../workspaceIndexer');
const { checkCode } = require('../codeChecker');

const FILES_PER_WORKER = Math.max(1000, Number(process.env.NEXUS_HEAVY_FILES) || 5000);
const SAVES_PER_WORKER = Math.max(500, Number(process.env.NEXUS_HEAVY_SAVES) || 1000);
const CHECKS_PER_WORKER = Math.max(500, Number(process.env.NEXUS_HEAVY_CHECKS) || 1500);
const BUILDS_PER_WORKER = Math.max(4, Number(process.env.NEXUS_HEAVY_BUILDS) || 8);

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function mapBatches(items, width, operation) {
  for (let offset = 0; offset < items.length; offset += width) await Promise.all(items.slice(offset, offset + width).map(operation));
}

async function buildArtifact(project, output, expectedFiles) {
  const names = (await fsp.readdir(project, { recursive:true, withFileTypes:true }))
    .filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath || entry.path, entry.name)).sort();
  if (names.length !== expectedFiles) throw new Error(`Build saw ${names.length} files; expected ${expectedFiles}.`);
  const digest = crypto.createHash('sha256');
  for (const name of names) digest.update(path.relative(project, name)).update(await fsp.readFile(name));
  const artifact = { complete:true, fileCount:names.length, digest:digest.digest('hex') };
  await fsp.writeFile(output, JSON.stringify(artifact));
}

function spawnBuild(project, output, expectedFiles) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, '--build', project, output, String(expectedFiles)], { stdio:['ignore','pipe','pipe'], windowsHide:true });
    let diagnostics = '';
    child.stdout.on('data', (chunk) => { diagnostics += chunk; });
    child.stderr.on('data', (chunk) => { diagnostics += chunk; });
    child.on('error', reject);
    child.on('close', async (code) => {
      if (code !== 0) return reject(new Error(`Build subprocess exited ${code}: ${diagnostics.slice(-2000)}`));
      try {
        const artifact = JSON.parse(await fsp.readFile(output, 'utf8'));
        if (!artifact.complete || artifact.fileCount !== expectedFiles || !/^[a-f0-9]{64}$/.test(artifact.digest)) throw new Error('Build returned an incomplete artifact.');
        resolve(artifact);
      } catch (error) { reject(error); }
    });
  });
}

async function run(workerId) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `nexus-heavy-${workerId}-`));
  const project = path.join(root, 'project');
  const artifacts = path.join(root, 'artifacts');
  await Promise.all([fsp.mkdir(project), fsp.mkdir(artifacts)]);
  try {
    const files = Array.from({ length:FILES_PER_WORKER }, (_, index) => {
      const extension = ['.js','.json','.html','.css'][index % 4];
      const relative = path.join(`group-${index % 100}`, `file-${index}${extension}`);
      const content = extension === '.json' ? JSON.stringify({ index, payload:'x'.repeat(384) }) : extension === '.html' ? `<main data-index="${index}">${'x'.repeat(384)}</main>` : extension === '.css' ? `.item-${index}{content:"${'x'.repeat(384)}"}` : `export const item${index} = ${JSON.stringify('x'.repeat(384))};`;
      return { path:relative, content };
    });
    await mapBatches(files, 100, async (file) => { const target = path.join(project, file.path); await fsp.mkdir(path.dirname(target), { recursive:true }); await fsp.writeFile(target, file.content); });

    let index = indexWorkspace(files);
    for (let round = 0; round < 3; round += 1) {
      const changed = files.map((file, fileIndex) => fileIndex % 50 === round ? { ...file, content:`${file.content}\n/* round ${round} */` } : file);
      const next = indexWorkspace(changed, index.hashes);
      if (!next.rootHash || next.changed.length === 0 || next.hashes[files[0].path] !== hash(changed[0].content)) throw new Error('Incremental workspace index became inconsistent under load.');
      index = next;
    }

    const stateFile = path.join(root, 'shared-state.json');
    await Promise.all(Array.from({ length:SAVES_PER_WORKER }, (_, sequence) => writeJsonAtomic(stateFile, { workerId, sequence, payload:'s'.repeat(2048) })));
    const saved = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
    if (saved.workerId !== workerId || !Number.isInteger(saved.sequence) || saved.payload.length !== 2048) throw new Error('Concurrent atomic save produced corrupt state.');

    const diagnostics = await Promise.all(files.slice(0, CHECKS_PER_WORKER).map((file) => checkCode({ folder:project, filePath:path.join(project, file.path), content:file.content, allowExternal:false })));
    if (diagnostics.some((result) => !result.ok || !result.recognized || result.diagnostics.some((item) => item.severity === 'error'))) throw new Error('Checker produced an unexpected error under load.');

    const builds = await Promise.all(Array.from({ length:BUILDS_PER_WORKER }, (_, build) => spawnBuild(project, path.join(artifacts, `build-${build}.json`), FILES_PER_WORKER)));
    if (new Set(builds.map((item) => item.digest)).size !== 1) throw new Error('Parallel builds produced different artifacts from identical input.');
    return { workerId, files:FILES_PER_WORKER, saves:SAVES_PER_WORKER, checks:CHECKS_PER_WORKER, builds:BUILDS_PER_WORKER };
  } finally { await fsp.rm(root, { recursive:true, force:true }); }
}

if (process.argv[2] === '--build') buildArtifact(process.argv[3], process.argv[4], Number(process.argv[5])).catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
else run(process.env.NEXUS_STRESS_WORKER || process.argv[2] || '1').then((summary) => console.log(JSON.stringify(summary))).catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { run, buildArtifact };
