# Client-owned test fixture; run inside authorized Windows desktop only.
# Use installed signed VirtioFS/WinFsp driver, exchange drive letter X:.
param([Parameter(Mandatory=$true)][string]$Exchange)
$ErrorActionPreference = 'Stop'
$installer = Join-Path $Exchange 'in-software.exe'
$p = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -Wait
if ($p.ExitCode -ne 0) { throw "7-Zip installer failed" }
$exe = Join-Path $env:ProgramFiles '7-Zip\7z.exe'
$gui = Join-Path $env:ProgramFiles '7-Zip\7zFM.exe'
if (!(Test-Path $exe) -or !(Test-Path $gui)) { throw "7-Zip not installed" }
$work = Join-Path $env:TEMP ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory $work | Out-Null
try {
  $payload = [Text.Encoding]::ASCII.GetBytes("VM Interface Windows 7-Zip functional proof"+[char]10)
  [IO.File]::WriteAllBytes((Join-Path $work 'input.txt'),$payload)
  & $exe a (Join-Path $work 'proof.7z') (Join-Path $work 'input.txt') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Archive creation failed" }
  & $exe t (Join-Path $work 'proof.7z') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Archive validation failed" }
  & $exe x (Join-Path $work 'proof.7z') ("-o"+(Join-Path $work 'extract')) -y | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Archive extraction failed" }
  $result = Join-Path $work 'extract\input.txt'
  if ((Get-FileHash $result).Hash -ne (Get-FileHash (Join-Path $work 'input.txt')).Hash) { throw "Roundtrip mismatch" }
  $temp = Join-Path $Exchange '.proof-result.tmp'
  Copy-Item $result $temp
  Move-Item $temp (Join-Path $Exchange 'out-result.txt')
  $digest = (Get-FileHash $result -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText((Join-Path $Exchange '.proof-hash.tmp'),$digest+[char]10,[Text.Encoding]::ASCII)
  Move-Item (Join-Path $Exchange '.proof-hash.tmp') (Join-Path $Exchange 'out-result.txt.sha256')
  Start-Process $gui -ArgumentList (Join-Path $work 'proof.7z')
  # Keep archive available to the running UI until the test machine is removed.
  Write-Host "WINDOWSPROOFCOMPLETE"
} catch { Write-Error $_; throw }
