$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$portableLauncher = Join-Path $projectRoot 'overlay-desktop\launcher\dist\RX-AI-Studio-Launcher-0.1.0.exe'
$unpackedLauncher = Join-Path $projectRoot 'overlay-desktop\launcher\dist\win-unpacked\RX AI Studio Launcher.exe'
$launcher = if (Test-Path -LiteralPath $portableLauncher) { $portableLauncher } elseif (Test-Path -LiteralPath $unpackedLauncher) { $unpackedLauncher } else { $null }

if (-not $launcher) {
  throw 'Launcherul nu este construit. Ruleaza mai intai: npm.cmd run launcher:dist'
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'RX AI Studio.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = '{0},0' -f $launcher
$shortcut.Description = 'Porneste RX AI Studio, dashboardul si generatorul de descrieri'
$shortcut.Save()

Write-Host ('Shortcut creat: {0}' -f $shortcutPath) -ForegroundColor Green

$taskName = 'RX AI Studio Welcome'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction = New-ScheduledTaskAction -Execute $launcher -Argument '--startup' -WorkingDirectory $projectRoot
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
Write-Host ('Task de pornire creat: {0} (la logare, fara intarziere).' -f $taskName) -ForegroundColor Green
