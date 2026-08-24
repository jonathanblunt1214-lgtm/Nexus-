const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');

function expectedPackageFiles() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.build.files.filter((entry) => typeof entry === 'string').map((entry) => entry.replace(/\\/g, '/'));
}

function verifySourcePackageList() {
  const missing = expectedPackageFiles().filter((entry) => !fs.existsSync(path.join(root, entry)));
  if (missing.length) throw new Error(`Nexus package configuration references missing files: ${missing.join(', ')}`);
  return { expected:expectedPackageFiles(), missing:[] };
}

function verifyPackagedContents(asarPath = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar')) {
  const source = verifySourcePackageList();
  if (!fs.existsSync(asarPath)) throw new Error(`Packaged Nexus archive is missing: ${asarPath}`);
  const packaged = new Set(asar.listPackage(asarPath).map((entry) => entry.replace(/^[/\\]+/, '').replace(/\\/g, '/')));
  const missing = source.expected.filter((entry) => !packaged.has(entry));
  if (missing.length) throw new Error(`Packaged Nexus update omitted required files: ${missing.join(', ')}`);
  const packagedPackage = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (packagedPackage.version !== sourcePackage.version) throw new Error(`Packaged version ${packagedPackage.version} does not match source ${sourcePackage.version}.`);
  const manifest = JSON.parse(asar.extractFile(asarPath, 'repository-file-manifest.json').toString('utf8'));
  if (manifest.scope !== 'Nexus only: every Git-tracked Nexus file except this self-referential manifest' || !Array.isArray(manifest.files)) throw new Error('Packaged Nexus offline repository manifest is invalid.');
  return { expectedCount:source.expected.length, packagedCount:packaged.size, version:sourcePackage.version, repositoryFiles:manifest.fileCount };
}

if (require.main === module) {
  const result = process.argv.includes('--source-only') ? verifySourcePackageList() : verifyPackagedContents(process.argv[2]);
  console.log(`[package inventory] Verified ${result.expectedCount || result.expected.length} required Nexus files${result.packagedCount ? ` inside ${result.packagedCount} packaged entries` : ''}.`);
}

module.exports = { expectedPackageFiles, verifySourcePackageList, verifyPackagedContents };
