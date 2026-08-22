param(
  [string]$PfxPath
)

$ErrorActionPreference = 'Stop'
if (-not $PfxPath) {
  $backupDirectory = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Nexus Signing Backup'
  $PfxPath = Get-ChildItem -LiteralPath $backupDirectory -Filter '*.pfx' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $PfxPath -or -not (Test-Path -LiteralPath $PfxPath -PathType Leaf)) {
  throw 'Portable Nexus .pfx backup not found. Pass its path with -PfxPath.'
}

$password = Read-Host 'Enter the PFX recovery password' -AsSecureString
$certificate = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation Cert:\CurrentUser\My -Password $password -Exportable
if (-not $certificate -or -not $certificate.HasPrivateKey -or $certificate.Subject -ne 'CN=Nexus Local Development') {
  throw 'The imported file is not a usable Nexus signing certificate.'
}

$temporaryCertificate = Join-Path ([System.IO.Path]::GetTempPath()) "nexus-local-signing-$($certificate.Thumbprint).cer"
try {
  Export-Certificate -Cert $certificate -FilePath $temporaryCertificate -Force | Out-Null
  Import-Certificate -FilePath $temporaryCertificate -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
} finally {
  Remove-Item -LiteralPath $temporaryCertificate -Force -ErrorAction SilentlyContinue
}

Write-Host "Restored and trusted Nexus signing certificate $($certificate.Thumbprint)."
Write-Host "Expires: $($certificate.NotAfter.ToString('yyyy-MM-dd'))"
