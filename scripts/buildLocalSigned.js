const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { build, Platform } = require('electron-builder');

const CERTIFICATE_SUBJECT = 'Nexus Local Development';
const MIN_INSTALLER_BYTES = 10 * 1024 * 1024;
const MIN_BLOCKMAP_BYTES = 100;

function findCertificate() {
  const command = [
    `$cert = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object {`,
    `  $_.Subject -eq 'CN=${CERTIFICATE_SUBJECT}' -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date)`,
    `} | Sort-Object NotAfter -Descending | Select-Object -First 1;`,
    `if (-not $cert) { exit 2 };`,
    `$root = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser');`,
    `$root.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite);`,
    `try { if (-not ($root.Certificates | Where-Object Thumbprint -eq $cert.Thumbprint)) { $root.Add($cert) } } finally { $root.Close() };`,
    `$cert.Thumbprint`,
  ].join(' ');
  return execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
  }).trim().toUpperCase();
}

function verifySignature(filePath, expectedThumbprint) {
  const escapedPath = filePath.replace(/'/g, "''");
  const command = [
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}';`,
    `[PSCustomObject]@{ Status = [string]$signature.Status; Thumbprint = $signature.SignerCertificate.Thumbprint } | ConvertTo-Json -Compress`,
  ].join(' ');
  const result = JSON.parse(execFileSync(
    'pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }
  ));
  if (result.Status !== 'Valid' || result.Thumbprint !== expectedThumbprint) {
    throw new Error(`Signature verification failed for ${filePath}: ${JSON.stringify(result)}`);
  }
}

function expectedArtifacts() {
  const projectRoot = path.resolve(__dirname, '..');
  const version = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;
  const output = path.join(projectRoot, 'dist');
  return {
    installer:path.join(output, `Nexus Setup ${version}.exe`),
    blockMap:path.join(output, `Nexus Setup ${version}.exe.blockmap`),
    executable:path.join(output, 'win-unpacked', 'Nexus.exe'),
  };
}

function removeStaleArtifacts(artifacts) {
  for (const file of [artifacts.installer, artifacts.blockMap]) fs.rmSync(file, { force:true });
}

function validateArtifacts(artifacts, thumbprint, signatureVerifier = verifySignature) {
  for (const [label, file] of Object.entries(artifacts)) {
    if (!fs.existsSync(file)) throw new Error(`Signed build is incomplete: ${label} was not created (${file}).`);
  }
  const installerBytes = fs.statSync(artifacts.installer).size;
  if (installerBytes < MIN_INSTALLER_BYTES) throw new Error(`Signed build is incomplete: installer is only ${installerBytes} bytes.`);
  const blockMapBytes = fs.statSync(artifacts.blockMap).size;
  if (blockMapBytes < MIN_BLOCKMAP_BYTES) throw new Error(`Signed build is incomplete: update block map is only ${blockMapBytes} bytes.`);
  signatureVerifier(artifacts.executable, thumbprint);
  signatureVerifier(artifacts.installer, thumbprint);
  return { installerBytes, blockMapBytes };
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Local Nexus signing is available only on Windows.');
  const thumbprint = findCertificate();
  process.env.NEXUS_LOCAL_SIGNING_THUMBPRINT = thumbprint;
  const artifacts = expectedArtifacts();
  removeStaleArtifacts(artifacts);
  await build({
    targets: Platform.WINDOWS.createTarget('nsis'),
    publish: 'never',
    config: {
      win: {
        signtoolOptions: {
          sign: path.join(__dirname, 'signLocalWindows.js'),
          publisherName: CERTIFICATE_SUBJECT,
          signingHashAlgorithms: ['sha256'],
        },
      },
    },
  });
  const result = validateArtifacts(artifacts, thumbprint);
  console.log(`Signed and verified Nexus installer (${result.installerBytes} bytes) with ${CERTIFICATE_SUBJECT}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[SIGNED BUILD FAILED] ${error.message}`);
    process.exit(1);
  });
}

module.exports = { MIN_INSTALLER_BYTES, expectedArtifacts, removeStaleArtifacts, validateArtifacts };
