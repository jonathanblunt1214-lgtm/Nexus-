param(
  [ValidateRange(1, 3650)]
  [int]$RenewWithinDays = 180,

  [ValidateRange(1, 10)]
  [int]$ValidYears = 5,

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
  -KeyExportPolicy NonExportable `
  -NotAfter $now.AddYears($ValidYears)

$temporaryCertificate = Join-Path ([System.IO.Path]::GetTempPath()) "nexus-local-signing-$($replacement.Thumbprint).cer"
try {
  Export-Certificate -Cert $replacement -FilePath $temporaryCertificate -Force | Out-Null
  Import-Certificate -FilePath $temporaryCertificate -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
} finally {
  Remove-Item -LiteralPath $temporaryCertificate -Force -ErrorAction SilentlyContinue
}

Write-Host "Renewed Nexus local signing certificate."
Write-Host "Thumbprint: $($replacement.Thumbprint)"
Write-Host "Expires: $($replacement.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host 'Previous certificates were retained so existing signatures remain verifiable.'
