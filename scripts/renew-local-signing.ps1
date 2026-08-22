param(
  [ValidateRange(1, 3650)]
  [int]$RenewWithinDays = 180,

  [ValidateRange(1, 10)]
  [int]$ValidYears = 5,

  [string]$BackupDirectory = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Nexus Signing Backup'),

  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$subject = 'CN=Nexus Local Development'
$now = Get-Date
$renewBy = $now.AddDays($RenewWithinDays)
$existing = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.Subject -eq $subject -and $_.HasPrivateKey -and $_.NotAfter -gt $now } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if ($existing -and -not $Force -and $existing.NotAfter -gt $renewBy) {
  Write-Host "No renewal needed. Nexus certificate expires $($existing.NotAfter.ToString('yyyy-MM-dd'))."
  Write-Host "Run again with -Force only if you intentionally want a replacement now."
  exit 0
}

$replacement = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $subject `
  -FriendlyName 'Nexus Local Development Signing' `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter $now.AddYears($ValidYears)

New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
$alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+='
$bytes = New-Object byte[] 40
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$passwordText = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
$securePassword = ConvertTo-SecureString $passwordText -AsPlainText -Force
$stamp = $now.ToString('yyyyMMdd-HHmmss')
$pfxPath = Join-Path $BackupDirectory "Nexus-Local-Signing-$stamp.pfx"
$publicPath = Join-Path $BackupDirectory "Nexus-Local-Signing-$stamp.cer"
$passwordPath = Join-Path $BackupDirectory "Nexus-Local-Signing-$stamp-Recovery-Password.txt"
Export-PfxCertificate -Cert $replacement -FilePath $pfxPath -Password $securePassword -CryptoAlgorithmOption AES256_SHA256 -ChainOption EndEntityCertOnly -Force | Out-Null
Export-Certificate -Cert $replacement -FilePath $publicPath -Force | Out-Null
Import-Certificate -FilePath $publicPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
[System.IO.File]::WriteAllLines($passwordPath, @(
  'Nexus portable signing certificate recovery password',
  'Keep this file separate from its matching .pfx after copying both to secure storage.',
  '',
  $passwordText
), [System.Text.UTF8Encoding]::new($false))

Write-Host "Renewed Nexus local signing certificate."
Write-Host "Thumbprint: $($replacement.Thumbprint)"
Write-Host "Expires: $($replacement.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host "PFX backup: $pfxPath"
Write-Host "Password recovery: $passwordPath"
Write-Host 'Previous certificates were retained so existing signatures remain verifiable.'
