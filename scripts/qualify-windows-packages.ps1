param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location (Split-Path -Parent $PSScriptRoot)
$Sources = Get-Content showcases/media-sources.json -Raw | ConvertFrom-Json
$Work = Join-Path $env:RUNNER_TEMP ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $Work,$Output -Force | Out-Null
try {
  $Records = @()
  foreach ($Key in @("winfsp","software","virtio")) {
    $Spec = $Sources.$Key
    $File = python scripts/fetch-pinned-media.py $Key $Work
    if ($LASTEXITCODE -ne 0) { throw "Pinned media download failed: $Key" }
    $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash.ToLowerInvariant()
    if ($Actual -ne $Spec.sha256) { throw "Unexpected media SHA: $Key" }
    $Signature = Get-AuthenticodeSignature -LiteralPath $File
    $Records += [ordered]@{
      key=$Key; name=$Spec.name; version=$Spec.version; source=$Spec.url; sha256=$Actual;
      bytes=(Get-Item -LiteralPath $File).Length; signatureStatus=[string]$Signature.Status;
      signerThumbprint=$Signature.SignerCertificate.Thumbprint; signerSubject=$Signature.SignerCertificate.Subject;
      installed=$false
    }
    [ordered]@{packages=$Records; windowsIsoAcquired=$false; guestCompatibilityVerified=$false} |
      ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $Output "windows-packages.json")
    if ($Key -ne "software" -and ($Signature.Status -ne "Valid" -or -not $Signature.SignerCertificate)) { throw "Driver signature not trusted: $Key ($($Signature.Status))" }
  }
  [ordered]@{packages=$Records; windowsIsoAcquired=$false; guestCompatibilityVerified=$false} |
    ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $Output "windows-packages.json")
} finally {
  Remove-Item -Recurse -Force $Work
}
