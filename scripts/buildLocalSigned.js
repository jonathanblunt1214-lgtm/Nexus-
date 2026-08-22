const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { build, Platform } = require('electron-builder');

const CERTIFICATE_SUBJECT = 'Nexus Local Development';

function findCertificate() {
  const output = execFileSync('certutil.exe', ['-user', '-store', 'My', CERTIFICATE_SUBJECT], { encoding: 'utf8' });
  const match = output.match(/Cert Hash\(sha1\):\s*([0-9a-f]+)/i);
  if (!match) throw new Error(`The ${CERTIFICATE_SUBJECT} certificate was not found in the current user's Personal store.`);
  return match[1].toUpperCase();
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

async function main() {
  if (process.platform !== 'win32') throw new Error('Local Nexus signing is available only on Windows.');
  const thumbprint = findCertificate();
  process.env.NEXUS_LOCAL_SIGNING_THUMBPRINT = thumbprint;
  const artifacts = await build({
    targets: Platform.WINDOWS.createTarget('nsis'),
    publish: 'never',
    config: {
      win: {
        sign: path.join(__dirname, 'signLocalWindows.js'),
        publisherName: CERTIFICATE_SUBJECT,
        signingHashAlgorithms: ['sha256'],
      },
    },
  });
  const installers = artifacts.filter((file) => file.toLowerCase().endsWith('.exe') && fs.existsSync(file));
  if (!installers.length) throw new Error('The build completed without producing a Windows installer.');
  for (const installer of installers) verifySignature(installer, thumbprint);
  console.log(`Signed and verified ${installers.length} Nexus installer(s) with ${CERTIFICATE_SUBJECT}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
