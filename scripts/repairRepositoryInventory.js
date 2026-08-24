const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'repository-file-manifest.json');

function hashFile(file) {
  const content = fs.readFileSync(file);
  return { size:content.length, sha256:crypto.createHash('sha256').update(content).digest('hex') };
}

function findInventoryDamage(manifest, repositoryRoot = root) {
  const missing = [];
  const changed = [];
  for (const expected of manifest.files || []) {
    const target = path.resolve(repositoryRoot, expected.path);
    if (target !== repositoryRoot && !target.startsWith(`${repositoryRoot}${path.sep}`)) throw new Error(`Unsafe manifest path: ${expected.path}`);
    if (!fs.existsSync(target)) { missing.push(expected); continue; }
    const actual = hashFile(target);
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) changed.push({ expected, actual });
  }
  return { missing, changed };
}

function download(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many GitHub redirects.'));
  return new Promise((resolve, reject) => {
    https.get(url, { headers:{ 'User-Agent':'Nexus-inventory-repair', Accept:'application/octet-stream' } }, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) { response.resume(); resolve(download(response.headers.location, redirects + 1)); return; }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`GitHub returned HTTP ${response.statusCode}.`)); return; }
      const chunks = []; let bytes = 0;
      response.on('data', (chunk) => { bytes += chunk.length; if (bytes > 50 * 1024 * 1024) response.destroy(new Error('Repair download exceeded 50 MB.')); else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function repairMissingFiles({ ref, attempts = 2 } = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const damage = findInventoryDamage(manifest);
  if (damage.changed.length) throw new Error(`Refusing automatic overwrite of changed Nexus files: ${damage.changed.map((item) => item.expected.path).join(', ')}`);
  if (!damage.missing.length) return { repaired:[] };
  const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const sourceRef = ref || process.env.NEXUS_REPAIR_REF || `v${packageVersion}`;
  const repaired = [];
  for (const expected of damage.missing) {
    const encodedPath = expected.path.split('/').map(encodeURIComponent).join('/');
    const url = `https://raw.githubusercontent.com/jonathanblunt1214-lgtm/Nexus-/${encodeURIComponent(sourceRef)}/${encodedPath}`;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const content = await download(url);
        const sha256 = crypto.createHash('sha256').update(content).digest('hex');
        if (content.length !== expected.size || sha256 !== expected.sha256) throw new Error(`GitHub file did not match the offline baseline (expected ${expected.sha256}, received ${sha256}).`);
        const target = path.join(root, ...expected.path.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive:true });
        const temporary = `${target}.nexus-repair-${process.pid}-${Date.now()}`;
        fs.writeFileSync(temporary, content, { flag:'wx' });
        fs.renameSync(temporary, target);
        repaired.push(expected.path);
        lastError = null;
        break;
      } catch (error) { lastError = error; }
    }
    if (lastError) throw new Error(`Could not repair ${expected.path} after ${attempts} attempts: ${lastError.message}`);
  }
  execFileSync(process.execPath, [path.join(__dirname, 'verifyRepositoryInventory.js')], { cwd:root, stdio:'inherit' });
  return { repaired };
}

if (require.main === module) repairMissingFiles().then((result) => console.log(`[inventory repair] Restored ${result.repaired.length} missing Nexus file(s) and passed the retry check.`)).catch((error) => { console.error(`[inventory repair failed] ${error.message}`); process.exit(1); });

module.exports = { findInventoryDamage, repairMissingFiles };
