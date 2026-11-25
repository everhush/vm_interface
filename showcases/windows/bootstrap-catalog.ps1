# Run inside a disposable authorized Windows VM, never on the Linux host.
# No trust-store modifications, unsigned drivers or execution-policy bypass.
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z]:$')][string]$Drive,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ChallengeSha256
)
$ErrorActionPreference='Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Elevated guest prompt required' }
$manifest=Get-Content (Join-Path $PSScriptRoot 'driver-files.json') -Raw | ConvertFrom-Json
if ($manifest.iso.sha256 -ne '303f7ae40dad495d6ae474fdc571df58958a4dbc5c37a522d80f9a203867949d' -or $manifest.catalog.name -ne 'viofs.cat' -or $manifest.winfsp.name -ne 'winfsp.msi') { throw 'Unexpected driver manifest' }
if ((@($manifest.files.name | Sort-Object) -join ',') -ne 'viofs.inf,viofs.sys,virtiofs.exe') { throw 'Unexpected driver file set' }
foreach ($p in @($manifest.catalog,$manifest.winfsp)+@($manifest.files)) {
  $file=Join-Path $PSScriptRoot $p.name
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $p.sha256) { throw 'Pinned package bytes differ' }
  if ($p.bytes -and (Get-Item -LiteralPath $file).Length -ne $p.bytes) { throw 'Pinned package length differs' }
  $thumb=if ($p.signerThumbprint) {$p.signerThumbprint} elseif ($p.embeddedSignerThumbprint) {$p.embeddedSignerThumbprint} else {$null}
  if ($thumb) {
    $sig=Get-AuthenticodeSignature -LiteralPath $file
    if ($sig.Status -ne 'Valid' -or !$sig.SignerCertificate -or $sig.SignerCertificate.Thumbprint -ne $thumb) { throw 'Driver catalog or executable signature differs' }
  }
}
$winfsp=Join-Path $PSScriptRoot 'winfsp.msi'
$proc=Start-Process msiexec.exe -ArgumentList @('/i',('"' + $winfsp + '"'),'/quiet','/norestart') -Wait -PassThru
if ($proc.ExitCode -eq 3010) { throw 'Authorized reboot required; bootstrap incomplete' }
if ($proc.ExitCode -ne 0) { throw 'WinFsp MSI failed' }
# Windows PnP validates catalog membership and kernel signing policy. No policy changes.
& pnputil.exe /add-driver (Join-Path $PSScriptRoot 'viofs.inf') /install
if ($LASTEXITCODE -ne 0) { throw 'Signed VirtIO driver package installation failed' }
if (Get-Service VirtioFsSvc -ErrorAction SilentlyContinue) { throw 'Existing VirtioFsSvc; use a clean guest' }
$dir=Join-Path $env:ProgramFiles 'VMInterfaceVirtioFS'
if (Test-Path -LiteralPath $dir) { throw 'Existing service directory; use a clean guest' }
New-Item -ItemType Directory -Path $dir | Out-Null
$exe=Join-Path $dir 'virtiofs.exe'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'virtiofs.exe') -Destination $exe
if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne ($manifest.files | Where-Object name -eq 'virtiofs.exe').sha256) { throw 'Copied service bytes differ' }
New-Service -Name VirtioFsSvc -BinaryPathName ('"'+$exe+'"') -DisplayName 'Virtio FS Service' -StartupType Automatic -DependsOn @('WinFsp.Launcher','VirtioFsDrv') | Out-Null
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
