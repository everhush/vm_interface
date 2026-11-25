# Run inside a disposable authorized Windows VM, never on the Linux host.
# No trust-store modifications, unsigned drivers or execution-policy bypass.
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z]:$')][string]$Drive,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ChallengeSha256
)
$ErrorActionPreference='Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Elevated guest prompt required' }
$packages = @(Get-Content (Join-Path $PSScriptRoot 'packages.json') -Raw | ConvertFrom-Json)
if ($packages.Count -ne 2 -or $packages[0].name -ne 'winfsp.msi' -or $packages[1].name -ne 'virtio.msi') { throw 'Unexpected package manifest' }
foreach ($p in $packages) {
  $file=Join-Path $PSScriptRoot $p.name
  if ((Get-Item $file).Length -ne $p.bytes -or (Get-FileHash $file -Algorithm SHA256).Hash -ne $p.sha256) { throw 'Package content mismatch' }
  $sig=Get-AuthenticodeSignature $file
  if ($sig.Status -ne 'Valid' -or !$sig.SignerCertificate -or $sig.SignerCertificate.Thumbprint -ne $p.signerThumbprint) { throw 'Package signature or pinned signer invalid' }
}
foreach ($p in $packages) {
  $file=Join-Path $PSScriptRoot $p.name
  $proc=Start-Process msiexec.exe -ArgumentList @('/i',('"' + $file + '"'),'/quiet','/norestart') -Wait -PassThru
  if ($proc.ExitCode -eq 3010) { throw 'Authorized reboot required; bootstrap not complete' }
  if ($proc.ExitCode -ne 0) { throw ('Driver MSI failed: ' + $proc.ExitCode) }
}
$svc=Get-Service -Name VirtioFsSvc -ErrorAction Stop
if ($svc.Status -ne 'Stopped') { Stop-Service -Name VirtioFsSvc -ErrorAction Stop }
$key='HKLM:\Software\VirtIO-FS'
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name MountPoint -PropertyType String -Value $Drive -Force | Out-Null
Set-Service -Name VirtioFsSvc -StartupType Automatic
Start-Service -Name VirtioFsSvc
$path=Join-Path ($Drive+'\') 'in-driver-challenge.bin'
$deadline=(Get-Date).AddSeconds(60)
do {
  if ((Test-Path $path -PathType Leaf) -and (Get-FileHash $path -Algorithm SHA256).Hash -eq $ChallengeSha256) {
    Write-Host 'VMDRIVERSREADY'
    return
  }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
throw 'Expected API-uploaded exchange challenge not visible through guest mount'
