# AgentSense uninstaller for the shared zip. Removes the installed app folder and the Start Menu and Desktop
# shortcuts that point to it. It refuses while AgentSense runs from that folder and never stops a process.
# It does NOT delete your data in %APPDATA%\AgentSense. The script only tells you where that folder is.
#
# Parameters. Double-clicking "Uninstall AgentSense.cmd" uses the defaults.
#   -InstallDir   Default: %LOCALAPPDATA%\Programs\AgentSense
#   -ShortcutDir  Default: %APPDATA%\Microsoft\Windows\Start Menu\Programs
#   -DesktopDir   Default: your Desktop folder
#   -Yes          Do not ask for confirmation.
param(
  [Alias('InstallDir')]
  [string]$install_dir = (Join-Path $env:LOCALAPPDATA 'Programs\AgentSense'),
  [Alias('ShortcutDir')]
  [string]$shortcut_dir = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  [Alias('DesktopDir')]
  [string]$desktop_dir = ([Environment]::GetFolderPath('Desktop')),
  [Alias('Yes')]
  [switch]$skip_confirm
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

try {
  $install_full = [System.IO.Path]::GetFullPath($install_dir).TrimEnd('\')
  $install_prefix = $install_full + '\'
  $installed_exe = Join-Path $install_dir 'AgentSense.exe'
  $install_exists = Test-Path -LiteralPath $install_dir
  if ($install_exists -and -not (Test-Path -LiteralPath $installed_exe)) {
    throw "$install_dir does not look like an AgentSense install (AgentSense.exe is missing). Nothing was removed."
  }

  $running = @(get_running_from $install_dir)
  if ($running.Count -gt 0) {
    throw "AgentSense is running from $install_dir (process id: $($running -join ', ')). Close AgentSense and run this uninstaller again. Nothing was removed."
  }

  $lnk_paths = @((Join-Path $shortcut_dir 'AgentSense.lnk'), (Join-Path $desktop_dir 'AgentSense.lnk'))
  $existing_lnks = @($lnk_paths | Where-Object { Test-Path -LiteralPath $_ })

  if (-not $install_exists -and $existing_lnks.Count -eq 0) {
    Write-Host "No AgentSense install was found in $install_dir, and no AgentSense shortcuts were found. Nothing to remove."
  } else {
    if (-not $skip_confirm) {
      Write-Host "This removes the AgentSense app from $install_dir and its Start Menu and Desktop shortcuts."
      Write-Host 'Your saved data in %APPDATA%\AgentSense is NOT removed.'
      $answer = Read-Host 'Continue? (Y/N)'
      if ($answer -notmatch '^\s*(y|yes)\s*$') {
        Write-Host 'Cancelled. Nothing was removed.'
        exit 0
      }
    }

    foreach ($lnk in $existing_lnks) {
      $target = get_shortcut_target $lnk
      if ($target -and $target.StartsWith($install_prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $lnk -Force
        Write-Host "Removed shortcut: $lnk"
      } else {
        Write-Host "Left alone (it does not point to $install_dir): $lnk"
      }
    }

    if ($install_exists) {
      Remove-Item -LiteralPath $install_dir -Recurse -Force
      Write-Host "Removed the app folder: $install_dir"
    }
  }

  $data_dir = Join-Path $env:APPDATA 'AgentSense'
  Write-Host ''
  Write-Host 'Your data was NOT removed by this uninstaller.'
  if (Test-Path -LiteralPath $data_dir) {
    Write-Host "  Data folder: $data_dir"
    Write-Host '  To delete it too: press Win+R, type %APPDATA%\AgentSense, press Enter, and delete that folder yourself.'
  } else {
    Write-Host "  No data folder was found at $data_dir."
  }
  Write-Host 'If you pinned AgentSense to the taskbar, right-click its icon and choose Unpin from taskbar.'
  Write-Host ''
  Write-Host 'Uninstall finished.'
} catch {
  Write-Host ''
  Write-Host "The uninstall did not finish: $($_.Exception.Message)"
  exit 1
}
