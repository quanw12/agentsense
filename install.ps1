# AgentSense installer for the shared zip. Per-user install, no administrator rights needed.
# Copies the app folder next to this script into the install folder, removes the download mark
# (Zone.Identifier) from the installed files, creates the Start Menu and Desktop shortcuts, and offers to
# start AgentSense. It never stops a process: if AgentSense is running from the install folder, it stops and
# changes nothing. It never reads or writes the user data folder (%APPDATA%\AgentSense).
#
# Parameters. Double-clicking "Install AgentSense.cmd" uses the defaults.
#   -InstallDir         Default: %LOCALAPPDATA%\Programs\AgentSense
#   -ShortcutDir        Folder for AgentSense.lnk in the Start Menu. Default: %APPDATA%\Microsoft\Windows\Start Menu\Programs
#   -DesktopDir         Folder for the Desktop shortcut. Default: your Desktop folder
#   -NoDesktopShortcut  Do not create the Desktop shortcut.
#   -NoLaunch           Do not offer to start AgentSense at the end.
#   -Force              Accepted for compatibility. An existing install is upgraded without it.
param(
  [Alias('InstallDir')]
  [string]$install_dir = (Join-Path $env:LOCALAPPDATA 'Programs\AgentSense'),
  [Alias('ShortcutDir')]
  [string]$shortcut_dir = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  [Alias('DesktopDir')]
  [string]$desktop_dir = ([Environment]::GetFolderPath('Desktop')),
  [Alias('NoDesktopShortcut')]
  [switch]$no_desktop_shortcut,
  [Alias('NoLaunch')]
  [switch]$no_launch,
  [Alias('Force')]
  [switch]$accept_force
)

$ErrorActionPreference = 'Stop'

# Returns the ids of the processes whose executable lives under $dir. Processes whose path cannot be read are skipped.
function get_running_from([string]$dir) {
  $prefix = [System.IO.Path]::GetFullPath($dir).TrimEnd('\') + '\'
  $ids = @()
  foreach ($proc in (Get-Process -ErrorAction SilentlyContinue)) {
    $proc_path = $null
    try { $proc_path = $proc.Path } catch { $proc_path = $null }
    if ($proc_path -and $proc_path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      $ids += $proc.Id
    }
  }
  return $ids
}

function get_shortcut_target([string]$lnk_path) {
  $shell = New-Object -ComObject WScript.Shell
  return $shell.CreateShortcut($lnk_path).TargetPath
}

function write_shortcut([string]$lnk_path, [string]$target_exe, [string]$work_dir) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($lnk_path)
  $shortcut.TargetPath = $target_exe
  $shortcut.WorkingDirectory = $work_dir
  $shortcut.IconLocation = "$target_exe,0"
  $shortcut.Description = 'AgentSense'
  $shortcut.Save()
}

function show_tool_checks {
  Write-Host ''
  Write-Host 'Checking tools on this PC (this installer does not install any of them):'
  if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host '  Git: found'
  } else {
    Write-Host '  Git: NOT found. Claude Code on Windows needs Git for Windows: https://git-scm.com/download/win'
  }
  $agent_names = @('claude', 'codex', 'droid', 'kimi', 'dsh', 'agy', 'cursor-agent', 'opencode', 'grok')
  $missing = @()
  foreach ($agent in $agent_names) {
    $found = Get-Command $agent -ErrorAction SilentlyContinue
    if ($found) {
      Write-Host "  Agent CLI found: $agent ($($found.Source))"
    } else {
      $missing += $agent
    }
  }
  if ($missing.Count -gt 0) {
    Write-Host "  Agent CLIs not found: $($missing -join ', ')"
  }
  Write-Host 'Coding agents are installed separately. The Terminal option in AgentSense works without any of them.'
}

try {
  $script_dir = $PSScriptRoot
  $app_dir = Join-Path $script_dir 'app'
  $source_exe = Join-Path $app_dir 'AgentSense.exe'
  if (-not (Test-Path -LiteralPath $source_exe)) {
    throw "The app folder was not found next to this installer ($app_dir). Unzip the WHOLE zip first, then run the installer from the unzipped folder, not from inside the zip."
  }

  $installed_exe = Join-Path $install_dir 'AgentSense.exe'
  $upgrading = $false
  if (Test-Path -LiteralPath $install_dir) {
    if (Test-Path -LiteralPath $installed_exe) {
      $upgrading = $true
    } elseif (@(Get-ChildItem -LiteralPath $install_dir -Force).Count -gt 0) {
      throw "The folder $install_dir already exists and is not an AgentSense install. Nothing was changed. Choose another -InstallDir or remove that folder yourself."
    }
  }

  $running = @(get_running_from $install_dir)
  if ($running.Count -gt 0) {
    throw "AgentSense is running from $install_dir (process id: $($running -join ', ')). Close AgentSense and run this installer again. Nothing was changed."
  }

  Write-Host 'AgentSense installer'
  Write-Host ''
  if ($upgrading) {
    Write-Host "An earlier AgentSense was found in $install_dir. Upgrading it."
  } else {
    Write-Host "Installing AgentSense to $install_dir"
  }

  # Stage the new build beside the install folder, verify it, then swap. A failed copy never replaces a working install.
  # %APPDATA%\AgentSense is not a path this script accepts.
  $parent = Split-Path -Parent $install_dir
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $stage = Join-Path $parent ("AgentSense.staging-" + $PID)
  $backup = Join-Path $parent ("AgentSense.backup-" + $PID)
  function assert_install_path([string]$candidate) {
    $full = [System.IO.Path]::GetFullPath($candidate)
    $root = [System.IO.Path]::GetFullPath($parent).TrimEnd('\') + '\'
    $appdata = [System.IO.Path]::GetFullPath($env:APPDATA).TrimEnd('\') + '\'
    if ($full.StartsWith($appdata, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to change $full because it is inside %APPDATA%."
    }
    if (-not ($full.TrimEnd('\') -eq $root.TrimEnd('\') -or $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase))) {
      throw "Refusing to change $full because it is outside $parent."
    }
  }
  assert_install_path $install_dir
  assert_install_path $stage
  assert_install_path $backup
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  & robocopy.exe $app_dir $stage /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    throw "Copying the files failed (robocopy exit code $LASTEXITCODE). The existing install was not replaced."
  }
  $staged_exe = Join-Path $stage 'AgentSense.exe'
  if (-not (Test-Path -LiteralPath $staged_exe)) {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    throw "The staged copy did not produce AgentSense.exe. The existing install was not replaced."
  }
  if ($upgrading) {
    Rename-Item -LiteralPath $install_dir -NewName (Split-Path -Leaf $backup)
    try {
      Rename-Item -LiteralPath $stage -NewName (Split-Path -Leaf $install_dir)
    } catch {
      Rename-Item -LiteralPath $backup -NewName (Split-Path -Leaf $install_dir)
      throw
    }
    Remove-Item -LiteralPath $backup -Recurse -Force
  } else {
    if (Test-Path -LiteralPath $install_dir) { Remove-Item -LiteralPath $install_dir -Recurse -Force }
    Rename-Item -LiteralPath $stage -NewName (Split-Path -Leaf $install_dir)
  }
  if (-not (Test-Path -LiteralPath $installed_exe)) {
    throw "The swap did not produce $installed_exe."
  }

  # Files extracted from a downloaded zip carry the download mark. Remove it so Windows does not block them.
  $unblocked = 0
  foreach ($file in @(Get-ChildItem -LiteralPath $install_dir -Recurse -File)) {
    $mark = Get-Item -LiteralPath $file.FullName -Stream 'Zone.Identifier' -ErrorAction SilentlyContinue
    if ($mark) {
      Unblock-File -LiteralPath $file.FullName
      $unblocked++
    }
  }
  $still_marked = 0
  foreach ($file in @(Get-ChildItem -LiteralPath $install_dir -Recurse -File)) {
    if (Get-Item -LiteralPath $file.FullName -Stream 'Zone.Identifier' -ErrorAction SilentlyContinue) { $still_marked++ }
  }
  $installed_count = @(Get-ChildItem -LiteralPath $install_dir -Recurse -File).Count

  $start_lnk = Join-Path $shortcut_dir 'AgentSense.lnk'
  New-Item -ItemType Directory -Force -Path $shortcut_dir | Out-Null
  write_shortcut $start_lnk $installed_exe $install_dir
  if ((get_shortcut_target $start_lnk) -ne $installed_exe) {
    throw "The Start Menu shortcut does not point to $installed_exe."
  }

  $desktop_lnk = $null
  if (-not $no_desktop_shortcut) {
    New-Item -ItemType Directory -Force -Path $desktop_dir | Out-Null
    $desktop_lnk = Join-Path $desktop_dir 'AgentSense.lnk'
    write_shortcut $desktop_lnk $installed_exe $install_dir
    if ((get_shortcut_target $desktop_lnk) -ne $installed_exe) {
      throw "The Desktop shortcut does not point to $installed_exe."
    }
  }

  Write-Host ''
  Write-Host 'Done. This is what the installer did:'
  Write-Host "  - Copied $installed_count files to $install_dir"
  Write-Host "  - Removed the download mark from $unblocked files (Windows will not block them)"
  if ($still_marked -gt 0) {
    Write-Host "  - WARNING: $still_marked files still have a download mark. Windows may ask before running them."
  }
  Write-Host "  - Start Menu shortcut: $start_lnk"
  if ($desktop_lnk) {
    Write-Host "  - Desktop shortcut: $desktop_lnk"
  } else {
    Write-Host '  - Desktop shortcut: skipped (-NoDesktopShortcut)'
  }
  Write-Host '  - Your saved data is kept in %APPDATA%\AgentSense. This installer did not touch it.'
  Write-Host '  - To pin AgentSense to the taskbar: Start, type AgentSense, right-click it, Pin to taskbar.'

  show_tool_checks

  if (-not $no_launch) {
    Write-Host ''
    $answer = Read-Host 'Start AgentSense now? (Y/N)'
    if ($answer -match '^\s*(y|yes)\s*$') {
      Start-Process -FilePath $installed_exe -WorkingDirectory $install_dir
      Write-Host 'AgentSense started.'
    }
  }
  Write-Host ''
  Write-Host 'Installation finished.'
} catch {
  Write-Host ''
  Write-Host "The install did not finish: $($_.Exception.Message)"
  exit 1
}
