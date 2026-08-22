const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['node_modules', 'dist', '.git']);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(path.join(dir, entry.name));
  }
}

walk(root);
let failed = 0;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) continue;
  failed += 1;
  console.error(`[FAIL] syntax: ${path.relative(root, file)}`);
  console.error((result.stderr || result.stdout || '').trim());
}

if (failed) {
  console.error(`Syntax validation failed for ${failed} file(s).`);
  process.exit(1);
}
console.log(`[PASS] Syntax validation passed for ${files.length} JavaScript files.`);
