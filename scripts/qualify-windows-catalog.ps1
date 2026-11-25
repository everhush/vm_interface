param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location (Split-Path -Parent $PSScriptRoot)
$Sources = Get-Content showcases/media-sources.json -Raw | ConvertFrom-Json
$Work = Join-Path $env:RUNNER_TEMP ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $Work,$Output -Force | Out-Null
$Iso = Join-Path $Work 'virtio-win-0.1.302.iso'
$Url = 'https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/archive-virtio/virtio-win-0.1.302-1/virtio-win.iso'
$Report = [ordered]@{source=$Url; isoSha256=$null; isoBytes=$null; files=@(); packages=@(); guestCompatibilityVerified=$false; signatureVerificationPassed=$false}
function Save-Report { $Report | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $Output 'driver-catalog-report.json') }
try {
  foreach ($Key in @('winfsp','software')) {
    $File = python scripts/fetch-pinned-media.py $Key $Work
    if ($LASTEXITCODE -ne 0) { throw "Pinned download failed: $Key" }
    $Signature = Get-AuthenticodeSignature -LiteralPath $File
    $Report.packages += [ordered]@{key=$Key; sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash.ToLowerInvariant(); signatureStatus=[string]$Signature.Status; signerThumbprint=$Signature.SignerCertificate.Thumbprint; signerSubject=$Signature.SignerCertificate.Subject}
    Save-Report
    if ($Key -eq 'winfsp' -and $Signature.Status -ne 'Valid') { throw 'WinFsp signature not trusted' }
  }
  & curl.exe --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 30 --max-time 480 --max-filesize 1073741824 --output $Iso $Url
  if ($LASTEXITCODE -ne 0 -or (Get-Item -LiteralPath $Iso).Length -gt 1073741824) { throw 'Driver ISO acquisition failed' }
  $Report.isoSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $Iso).Hash.ToLowerInvariant()
  $Report.isoBytes=(Get-Item -LiteralPath $Iso).Length
  Save-Report
  if ($Report.isoSha256 -ne "303f7ae40dad495d6ae474fdc571df58958a4dbc5c37a522d80f9a203867949d" -or $Report.isoBytes -ne 877373440) { throw "Driver ISO differs from inspected version" }
  $Mount = Mount-DiskImage -ImagePath $Iso -Access ReadOnly -PassThru
  try {
    $Volume = $Mount | Get-Volume
    if (-not $Volume.DriveLetter) { throw 'Mounted ISO has no volume letter' }
    $Root = "$($Volume.DriveLetter):\"
    $Dir = Join-Path $Root 'viofs\2k22\amd64'
    if (-not (Test-Path -LiteralPath $Dir -PathType Container)) { throw 'Exact Server 2022 driver folder absent' }
    $Tool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $Tool) { throw 'Windows SDK signtool unavailable' }
    $Cats=@(Get-ChildItem -LiteralPath $Dir -Filter '*.cat' -File)
    if ($Cats.Count -ne 1) { throw 'Unexpected driver catalog layout' }
    $Cat=$Cats[0]
    $Sig=Get-AuthenticodeSignature -LiteralPath $Cat.FullName
    if ($Sig.Status -ne 'Valid' -or -not $Sig.SignerCertificate) { throw 'Driver catalog signature invalid' }
    $Report.catalog=[ordered]@{name=$Cat.Name;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $Cat.FullName).Hash.ToLowerInvariant();signerThumbprint=$Sig.SignerCertificate.Thumbprint;signerSubject=$Sig.SignerCertificate.Subject}
    Save-Report
    $Files=@(Get-ChildItem -LiteralPath $Dir -File | Where-Object { $_.Extension -in @('.inf','.sys','.exe','.dll') })
    if (-not ($Files.Extension -contains '.inf') -or -not ($Files.Extension -contains '.sys') -or -not ($Files.Name -contains 'virtiofs.exe')) { throw 'Required driver or service absent' }
    foreach ($File in $Files) {
      $Policy=if ($File.Extension -eq '.sys') {'/kp'} else {'/pa'}
      & $Tool.FullName verify $Policy /c $Cat.FullName $File.FullName
      $Verified=($LASTEXITCODE -eq 0)
      $Report.files += [ordered]@{name=$File.Name;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $File.FullName).Hash.ToLowerInvariant();bytes=$File.Length;catalogVerified=$Verified;policy=$Policy}
      if (-not $Verified -and $File.Extension -in @('.exe','.dll')) {
        # A user-mode binary can carry its own trusted embedded signature.
        # Kernel driver and INF still require catalog membership.
        $Embedded = Get-AuthenticodeSignature -LiteralPath $File.FullName
        $Verified = ($Embedded.Status -eq 'Valid' -and $null -ne $Embedded.SignerCertificate)
        $Report.files[-1].embeddedSignatureStatus = [string]$Embedded.Status
        $Report.files[-1].embeddedSignerThumbprint = $Embedded.SignerCertificate.Thumbprint
        $Report.files[-1].embeddedSignerSubject = $Embedded.SignerCertificate.Subject
      }
      Save-Report
      if (-not $Verified) { throw "Trusted signature verification failed: $($File.Name)" }
    }
    $Report.signatureVerificationPassed=$true
    Save-Report
  } finally {
    Dismount-DiskImage -ImagePath $Iso
  }
} finally {
  Save-Report
  Remove-Item -Recurse -Force $Work
}
