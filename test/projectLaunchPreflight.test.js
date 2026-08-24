const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { npmScriptForCommand, referencedNodeEntrypoints, referencedLocalExecutables, planProjectLaunch, verifyProjectLaunchPlan } = require('../projectLaunchPreflight');

function project(pkg, files = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-launch-preflight-'));
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify(pkg));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(folder, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
  }
  return folder;
}

test('recognizes npm launch scripts and their compiled Node entrypoints', () => {
  assert.equal(npmScriptForCommand('npm start'), 'start');
  assert.equal(npmScriptForCommand('npm run preview'), 'preview');
  assert.deepEqual(referencedNodeEntrypoints('node dist/server.cjs'), ['dist/server.cjs']);
  assert.deepEqual(referencedLocalExecutables('vite --host && node server.js'), ['vite']);
});

test('repairs a missing local script executable even when node_modules exists', () => {
  const folder = project({ scripts:{ dev:'vite --host' }, devDependencies:{ vite:'1' } }, { 'package-lock.json':'{}', 'node_modules/.keep':'' });
  const plan = planProjectLaunch(folder, 'npm run dev');
  assert.deepEqual(plan.missingExecutables, ['vite']);
  assert.deepEqual(plan.actions, [{ type:'install', args:['ci'] }]);
  fs.rmSync(folder, { recursive:true, force:true });
});

test('main process gates installs separately and keeps sandbox preparation inside Docker', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /actions\.some\(\(action\) => action\.type === 'install'\)[\s\S]*requireWorkspacePermission\(folder, 'dependencies'\)/);
  assert.match(main, /const sandboxCommand = \[\.\.\.preparationCommands, command\]\.join\(' && '\)/);
  assert.ok(main.indexOf('if (sandboxed) {', main.indexOf("ipcMain.handle('launch-project'")) < main.indexOf('prepareProjectForLaunch(id, folder, command, preflightPlan)'));
});

test('plans locked install and build when a GitHub download lacks dependencies and dist output', () => {
  const folder = project({ scripts:{ build:'vite build && esbuild server.ts --outfile=dist/server.cjs', start:'node dist/server.cjs' }, dependencies:{ express:'1' }, devDependencies:{ vite:'1' } }, { 'package-lock.json':'{}', 'server.ts':'' });
  const plan = planProjectLaunch(folder, 'npm start');
  assert.deepEqual(plan.actions, [{ type:'install', args:['ci'] }, { type:'build', args:['run', 'build'] }]);
  assert.equal(plan.missingBefore[0].entry, 'dist/server.cjs');
  assert.match(verifyProjectLaunchPlan(plan).error, /still missing after project preparation/);
  fs.rmSync(folder, { recursive:true, force:true });
});

test('accepts the launch only after the expected build artifact exists', () => {
  const folder = project({ scripts:{ build:'node build.js', start:'node dist/server.cjs' } }, { 'dist/server.cjs':'module.exports = {}' });
  const plan = planProjectLaunch(folder, 'npm start');
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(verifyProjectLaunchPlan(plan), { ok:true });
  fs.rmSync(folder, { recursive:true, force:true });
});
