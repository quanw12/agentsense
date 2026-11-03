param([string]$evidence_file = '')
$ErrorActionPreference = 'Stop'
$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixture = Join-Path ([System.IO.Path]::GetTempPath()) ('agentsense-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$install = Join-Path $fixture 'installed'
$shortcuts = Join-Path $fixture 'shortcuts'
$desktop = Join-Path $fixture 'desktop'
# Every install/uninstall/delete target is confined to this freshly owned fixture.
foreach ($target in @($install, $shortcuts, $desktop)) {
  if (-not ([System.IO.Path]::GetFullPath($target)).StartsWith($fixture + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture target' }
}
$sentinel = Join-Path $fixture 'preserve.txt'
Set-Content -LiteralPath $sentinel -Value 'keep me'
$runner = (Get-Process -Id $PID).Path
$options = @('-InstallDir', $install, '-ShortcutDir', $shortcuts, '-DesktopDir', $desktop, '-NoLaunch', '-NoDesktopShortcut')
foreach ($phase in @('install', 'reinstall')) {
  & $runner -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'install.ps1') @options
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $install 'AgentSense.exe'))) { throw "Failed $phase" }
  if (-not (Test-Path -LiteralPath (Join-Path $shortcuts 'AgentSense.lnk'))) { throw 'Missing fixture shortcut' }
  Write-Output "PASS $phase"
}
$before = (Get-FileHash -LiteralPath (Join-Path $install 'AgentSense.exe') -Algorithm SHA256).Hash
$broken = Join-Path $fixture 'broken-bundle'
New-Item -ItemType Directory -Path (Join-Path $broken 'app') | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'install.ps1') -Destination (Join-Path $broken 'install.ps1')
Set-Content -LiteralPath (Join-Path $broken 'app\AgentSense.exe') -Value 'corrupt payload'
@{exe_sha256=('0' * 64);source_hashes=@{'main.js'=('0' * 64)}} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $broken 'app\BUILD.json')
& $runner -NoProfile -ExecutionPolicy Bypass -File (Join-Path $broken 'install.ps1') @options
if ($LASTEXITCODE -eq 0) { throw 'Corrupt upgrade unexpectedly succeeded' }
if ((Get-FileHash -LiteralPath (Join-Path $install 'AgentSense.exe') -Algorithm SHA256).Hash -ne $before) { throw 'Failed upgrade changed the prior installation' }
Write-Output 'PASS corrupt upgrade preserves the existing installation'
& $runner -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'uninstall.ps1') -InstallDir $install -ShortcutDir $shortcuts -DesktopDir $desktop -Yes
if ($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath $install) -or (Test-Path -LiteralPath (Join-Path $shortcuts 'AgentSense.lnk'))) { throw 'Fixture uninstall failed' }
if ((Get-Content -LiteralPath $sentinel).Trim() -ne 'keep me') { throw 'Fixture data changed' }
Write-Output 'PASS uninstall preserves unrelated fixture data'
if ($evidence_file) {
  @{fixture=$fixture;install=$true;reinstall=$true;corrupt_upgrade_preserved=$true;uninstall=$true;sentinel_preserved=$true} | ConvertTo-Json | Set-Content -LiteralPath $evidence_file -Encoding utf8
}
exit 0
