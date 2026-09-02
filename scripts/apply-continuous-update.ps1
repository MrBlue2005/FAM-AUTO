[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$InstallRoot,
  [Parameter(Mandatory)][string]$PackagePath,
  [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
  [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$ExpectedCommit,
  [Parameter(Mandatory)][int]$ParentProcessId,
  [Parameter(Mandatory)][string]$RestartLauncherRelativePath,
  [string]$UpdatesRoot,
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Resolve-SafeChildPath {
  param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$RelativePath)
  $normalized = $RelativePath.Replace('/', '\').TrimStart('\')
  $segments = $normalized -split '\\'
  if ([IO.Path]::IsPathRooted($RelativePath) -or $segments -contains '..') {
    throw "Cale relativa nesigura in update: $RelativePath"
  }
  $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $resolved = [IO.Path]::GetFullPath((Join-Path $resolvedRoot $normalized))
  if (-not $resolved.StartsWith("$resolvedRoot\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Calea update-ului iese din folderul permis: $RelativePath"
  }
  return $resolved
}

function Assert-ManagedRelativePath {
  param([Parameter(Mandatory)][string]$RelativePath)
  $portable = $RelativePath.Replace('\', '/').TrimStart('/').ToLowerInvariant()
  $protected = @(
    '.env',
    'dashboard-v2/.env',
    'property-copywriter/.env',
    'property-copywriter/dev.db',
    '.rx-update-state.json'
  )
  $isProtected = $protected -contains $portable
  $isProtected = $isProtected -or $portable.StartsWith('.git/')
  $isProtected = $isProtected -or ($portable.StartsWith('app/data/') -and $portable.EndsWith('.json'))
  $isProtected = $isProtected -or $portable.StartsWith('app/data/properties/')
  $isProtected = $isProtected -or $portable.StartsWith('app/data/jobs/')
  $isProtected = $isProtected -or $portable.StartsWith('app/uploads/')
  $isProtected = $isProtected -or $portable.StartsWith('logs/')
  $isProtected = $isProtected -or $portable.StartsWith('runtime/')
  $isProtected = $isProtected -or $portable -match '(^|/)chrome-profile[^/]*/'
  if ($isProtected) {
    throw "Pachetul incearca sa modifice o cale locala protejata: $RelativePath"
  }
}

function Stop-InstalledProcesses {
  param([Parameter(Mandatory)][string]$Root)
  $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    $executablePath = [string]$_.ExecutablePath
    if ($_.ProcessId -ne $PID -and $executablePath.StartsWith("$resolvedRoot\", [StringComparison]::OrdinalIgnoreCase)) {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Stop-StudioServices {
  param([Parameter(Mandatory)][string]$Root)
  $nodeExecutable = Join-Path $Root 'runtime\node\node.exe'
  $stopScript = Join-Path $Root 'scripts\stop-studio.js'
  if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf) -or -not (Test-Path -LiteralPath $stopScript -PathType Leaf)) { return }
  Push-Location -LiteralPath $Root
  try {
    & $nodeExecutable $stopScript | Out-Null
  } finally {
    Pop-Location
  }
}

$resolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$resolvedPackagePath = [IO.Path]::GetFullPath($PackagePath)
if (-not (Test-Path -LiteralPath $resolvedInstallRoot -PathType Container)) { throw 'Folderul instalarii nu exista.' }
if (-not (Test-Path -LiteralPath $resolvedPackagePath -PathType Leaf)) { throw 'Pachetul update-ului nu exista.' }
$installedManifestPath = Join-Path $resolvedInstallRoot 'package.json'
$installedManifest = Get-Content -Raw -LiteralPath $installedManifestPath | ConvertFrom-Json
if ($installedManifest.name -ne 'facebook-automation') { throw 'Folderul selectat nu este o instalare RX AI Studio valida.' }

$actualPackageHash = (Get-FileHash -LiteralPath $resolvedPackagePath -Algorithm SHA256).Hash
if ($actualPackageHash -ne $ExpectedSha256.ToUpperInvariant()) { throw 'Checksum-ul pachetului s-a schimbat inainte de aplicare.' }

$hasCustomUpdatesRoot = -not [string]::IsNullOrWhiteSpace($UpdatesRoot)
$resolvedUpdatesRoot = if ($hasCustomUpdatesRoot) {
  [IO.Path]::GetFullPath($UpdatesRoot).TrimEnd('\')
} else {
  [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'RX AI Studio\updates')).TrimEnd('\')
}
$expectedUpdatesParent = if ($hasCustomUpdatesRoot) {
  [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
} else {
  [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\')
}
if (-not $resolvedUpdatesRoot.StartsWith("$expectedUpdatesParent\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Folderul temporar pentru update este invalid.'
}
New-Item -ItemType Directory -Path $resolvedUpdatesRoot -Force | Out-Null
$shortCommit = $ExpectedCommit.Substring(0, 12).ToLowerInvariant()
$extractRoot = Join-Path $resolvedUpdatesRoot "extract-$shortCommit"
$backupRoot = Join-Path $resolvedUpdatesRoot "backup-$shortCommit-$(Get-Date -Format 'yyyyMMddHHmmss')"
$logPath = Join-Path $resolvedUpdatesRoot 'continuous-update.log'

foreach ($temporaryRoot in @($extractRoot, $backupRoot)) {
  $resolvedTemporary = [IO.Path]::GetFullPath($temporaryRoot)
  if (-not $resolvedTemporary.StartsWith("$resolvedUpdatesRoot\", [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Folder temporar calculat in afara zonei de update.'
  }
}
if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
New-Item -ItemType Directory -Path $extractRoot, $backupRoot -Force | Out-Null

$updateFailure = $null
try {
  Expand-Archive -LiteralPath $resolvedPackagePath -DestinationPath $extractRoot -Force
  $bundleManifestPath = Join-Path $extractRoot 'update-manifest.json'
  $payloadRoot = Join-Path $extractRoot 'payload'
  if (-not (Test-Path -LiteralPath $bundleManifestPath -PathType Leaf) -or -not (Test-Path -LiteralPath $payloadRoot -PathType Container)) {
    throw 'Pachetul nu contine manifestul si payload-ul obligatoriu.'
  }
  $bundleManifest = Get-Content -Raw -LiteralPath $bundleManifestPath | ConvertFrom-Json
  if ($bundleManifest.format -ne 'rx-ai-studio-continuous-update' -or [int]$bundleManifest.schemaVersion -ne 1) {
    throw 'Formatul pachetului nu este compatibil.'
  }
  if ([string]$bundleManifest.commit -ne $ExpectedCommit) { throw 'Commitul din pachet nu coincide cu update-ul selectat.' }

  $manifestFiles = @($bundleManifest.files | ForEach-Object { [string]$_ })
  if (-not $manifestFiles.Count) { throw 'Pachetul de update nu contine fisiere administrate.' }
  $duplicateFiles = $manifestFiles | Group-Object | Where-Object Count -gt 1
  if ($duplicateFiles) { throw 'Manifestul update-ului contine cai duplicate.' }

  $manifestFileSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($relativePath in $manifestFiles) {
    Assert-ManagedRelativePath -RelativePath $relativePath
    $portablePath = $relativePath.Replace('\', '/')
    if ([IO.Path]::IsPathRooted($relativePath) -or $portablePath.Split('/') -contains '..') {
      throw "Cale relativa nesigura in manifest: $relativePath"
    }
    [void]$manifestFileSet.Add($portablePath)
  }
  $actualPayloadFiles = @(Get-ChildItem -LiteralPath $payloadRoot -File -Recurse | ForEach-Object {
    $_.FullName.Substring($payloadRoot.Length).TrimStart('\').Replace('\', '/')
  })
  foreach ($relativePath in $actualPayloadFiles) {
    if (-not $manifestFileSet.Contains($relativePath)) { throw "Payload-ul contine un fisier nedeclarat: $relativePath" }
  }
  if ($actualPayloadFiles.Count -ne $manifestFiles.Count) { throw 'Numarul fisierelor din payload nu coincide cu manifestul.' }

  if ($VerifyOnly) {
    Write-Host "Pachet continuu valid pentru commit $ExpectedCommit ($($manifestFiles.Count) fisiere)." -ForegroundColor Green
    exit 0
  }

  $waitDeadline = (Get-Date).AddSeconds(60)
  while (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) {
    if ((Get-Date) -ge $waitDeadline) { throw 'Launcherul nu s-a inchis la timp pentru aplicarea update-ului.' }
    Start-Sleep -Milliseconds 300
  }
  Stop-StudioServices -Root $resolvedInstallRoot
  Stop-InstalledProcesses -Root $resolvedInstallRoot
  Start-Sleep -Milliseconds 500

  $statePath = Join-Path $resolvedInstallRoot '.rx-update-state.json'
  $previousStateFiles = @()
  if (Test-Path -LiteralPath $statePath) {
    Copy-Item -LiteralPath $statePath -Destination (Join-Path $backupRoot '.rx-update-state.json') -Force
    try { $previousStateFiles = @((Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json).files | ForEach-Object { [string]$_ }) } catch { $previousStateFiles = @() }
  }

  $backedUp = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $createdFiles = [Collections.Generic.List[string]]::new()
  function Backup-InstalledFile {
    param([Parameter(Mandatory)][string]$RelativePath)
    if ($backedUp.Contains($RelativePath)) { return }
    $installedPath = Resolve-SafeChildPath -Root $resolvedInstallRoot -RelativePath $RelativePath
    if (Test-Path -LiteralPath $installedPath -PathType Leaf) {
      $backupPath = Resolve-SafeChildPath -Root (Join-Path $backupRoot 'files') -RelativePath $RelativePath
      New-Item -ItemType Directory -Path (Split-Path -Parent $backupPath) -Force | Out-Null
      Copy-Item -LiteralPath $installedPath -Destination $backupPath -Force
      [void]$backedUp.Add($RelativePath)
    } else {
      $createdFiles.Add($RelativePath)
    }
  }

  foreach ($relativePath in $manifestFiles) { Backup-InstalledFile -RelativePath $relativePath }
  $staleFiles = @($previousStateFiles | Where-Object { -not $manifestFileSet.Contains($_.Replace('\', '/')) })
  foreach ($relativePath in $staleFiles) {
    Assert-ManagedRelativePath -RelativePath $relativePath
    Backup-InstalledFile -RelativePath $relativePath
  }

  try {
    foreach ($relativePath in $manifestFiles) {
      $sourcePath = Resolve-SafeChildPath -Root $payloadRoot -RelativePath $relativePath
      $destinationPath = Resolve-SafeChildPath -Root $resolvedInstallRoot -RelativePath $relativePath
      New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
      Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }
    foreach ($relativePath in $staleFiles) {
      $stalePath = Resolve-SafeChildPath -Root $resolvedInstallRoot -RelativePath $relativePath
      if (Test-Path -LiteralPath $stalePath -PathType Leaf) { Remove-Item -LiteralPath $stalePath -Force }
    }

    $newState = [ordered]@{
      format = 'rx-ai-studio-update-state'
      schemaVersion = 1
      commit = $ExpectedCommit.ToLowerInvariant()
      appVersion = [string]$bundleManifest.appVersion
      appliedAt = (Get-Date).ToUniversalTime().ToString('o')
      packageSha256 = $ExpectedSha256.ToLowerInvariant()
      files = $manifestFiles
    }
    $newState | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
  } catch {
    foreach ($relativePath in $createdFiles) {
      $createdPath = Resolve-SafeChildPath -Root $resolvedInstallRoot -RelativePath $relativePath
      if (Test-Path -LiteralPath $createdPath -PathType Leaf) { Remove-Item -LiteralPath $createdPath -Force -ErrorAction SilentlyContinue }
    }
    $backupFilesRoot = Join-Path $backupRoot 'files'
    if (Test-Path -LiteralPath $backupFilesRoot) {
      Get-ChildItem -LiteralPath $backupFilesRoot -File -Recurse | ForEach-Object {
        $relativePath = $_.FullName.Substring($backupFilesRoot.Length).TrimStart('\')
        $restorePath = Resolve-SafeChildPath -Root $resolvedInstallRoot -RelativePath $relativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $restorePath) -Force | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $restorePath -Force
      }
    }
    $previousStateBackup = Join-Path $backupRoot '.rx-update-state.json'
    if (Test-Path -LiteralPath $previousStateBackup) {
      Copy-Item -LiteralPath $previousStateBackup -Destination $statePath -Force
    } elseif (Test-Path -LiteralPath $statePath) {
      Remove-Item -LiteralPath $statePath -Force
    }
    throw
  }

  "$(Get-Date -Format o) Applied $ExpectedCommit from $resolvedPackagePath" | Add-Content -LiteralPath $logPath -Encoding UTF8
  Get-ChildItem -LiteralPath $resolvedUpdatesRoot -Directory -Filter 'backup-*' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 2 |
    ForEach-Object {
      if ($_.FullName.StartsWith("$resolvedUpdatesRoot\", [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
} catch {
  "$(Get-Date -Format o) FAILED $ExpectedCommit - $($_.Exception.Message)" | Add-Content -LiteralPath $logPath -Encoding UTF8
  $updateFailure = $_
} finally {
  if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue }
  if ($VerifyOnly -and (Test-Path -LiteralPath $backupRoot)) { Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue }
}

$restartLauncherPath = Resolve-SafeChildPath -Root $resolvedInstallRoot -RelativePath $RestartLauncherRelativePath
if (-not (Test-Path -LiteralPath $restartLauncherPath -PathType Leaf)) { throw 'Launcherul actualizat nu a fost gasit pentru repornire.' }
Start-Process -FilePath $restartLauncherPath -WorkingDirectory $resolvedInstallRoot -WindowStyle Hidden
if ($updateFailure) { throw $updateFailure }
