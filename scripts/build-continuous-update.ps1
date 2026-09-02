[CmdletBinding()]
param(
  [switch]$SkipDependencyRefresh,
  [switch]$SkipBuild,
  [switch]$AllowDirty
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$installerRoot = Join-Path $projectRoot 'installer'
$stagingParent = Join-Path $installerRoot '.continuous-staging'
$bundleRoot = Join-Path $stagingParent 'bundle'
$payloadRoot = Join-Path $bundleRoot 'payload'
$distRoot = Join-Path $installerRoot 'dist'

function Invoke-Checked {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(ValueFromRemainingArguments)][string[]]$Arguments
  )
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Comanda a esuat cu codul ${LASTEXITCODE}: $Command $($Arguments -join ' ')" }
}

function Reset-SafeDirectory {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Parent)
  $resolvedPath = [IO.Path]::GetFullPath($Path)
  $resolvedParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\')
  if (-not $resolvedPath.StartsWith("$resolvedParent\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Folder temporar invalid: $resolvedPath"
  }
  if (Test-Path -LiteralPath $resolvedPath) { Remove-Item -LiteralPath $resolvedPath -Recurse -Force }
  New-Item -ItemType Directory -Path $resolvedPath -Force | Out-Null
}

function Copy-Tree {
  param([Parameter(Mandatory)][string]$RelativePath)
  $sourcePath = Join-Path $projectRoot $RelativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
    throw "Lipseste componenta obligatorie a update-ului: $RelativePath"
  }
  $destinationPath = Join-Path $payloadRoot $RelativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
}

function Copy-RequiredFile {
  param([Parameter(Mandatory)][string]$RelativePath)
  $sourcePath = Join-Path $projectRoot $RelativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Lipseste fisierul obligatoriu al update-ului: $RelativePath"
  }
  $destinationPath = Join-Path $payloadRoot $RelativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

Set-Location -LiteralPath $projectRoot
$appVersion = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
if ($appVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Versiune invalida: $appVersion" }
$commit = (& git.exe rev-parse HEAD).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') { throw 'Commitul Git curent nu a putut fi determinat.' }
$shortCommit = $commit.Substring(0, 12)
$dirtyFiles = @(& git.exe status --porcelain --untracked-files=no)
if ($dirtyFiles.Count -and -not $AllowDirty) {
  throw 'Arborele Git contine modificari urmarite. Commit toate schimbarile inainte de buildul continuu.'
}

if (-not $SkipDependencyRefresh) {
  Invoke-Checked npm.cmd ci
  Invoke-Checked npm.cmd --prefix dashboard-v2 ci
  Invoke-Checked npm.cmd --prefix property-copywriter ci
  Invoke-Checked npm.cmd --prefix overlay-desktop ci
}
if (-not $SkipBuild) {
  Invoke-Checked npm.cmd run build
  Invoke-Checked npm.cmd --prefix property-copywriter run build
  Invoke-Checked npm.cmd run overlay:dist
  Invoke-Checked npm.cmd run launcher:dist
}

Reset-SafeDirectory -Path $stagingParent -Parent $installerRoot
New-Item -ItemType Directory -Path $payloadRoot, $distRoot -Force | Out-Null

$trackedFiles = @(& git.exe ls-files --cached --others --exclude-standard)
if ($LASTEXITCODE -ne 0) { throw 'Nu am putut inventaria fisierele sursa pentru update.' }
foreach ($relativePath in $trackedFiles) {
  if ([string]::IsNullOrWhiteSpace($relativePath)) { continue }
  $portablePath = $relativePath.Replace('\', '/')
  if ($portablePath.StartsWith('.github/') -or $portablePath.StartsWith('docs/')) { continue }
  $sourcePath = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
  $destinationPath = Join-Path $payloadRoot $relativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

@(
  'node_modules',
  'dashboard-v2\node_modules',
  'dashboard-v2\dist',
  'property-copywriter\node_modules',
  'property-copywriter\.next'
) | ForEach-Object { Copy-Tree -RelativePath $_ }

@(
  'overlay-desktop\dist\RX-AI-Overlay-0.1.0.exe',
  'overlay-desktop\launcher\dist\RX-AI-Studio-Launcher-0.1.0.exe'
) | ForEach-Object { Copy-RequiredFile -RelativePath $_ }

@(
  (Join-Path $payloadRoot 'property-copywriter\.next\cache'),
  (Join-Path $payloadRoot 'property-copywriter\.next\dev')
) | ForEach-Object {
  if (Test-Path -LiteralPath $_) { Remove-Item -LiteralPath $_ -Recurse -Force }
}

$managedFiles = @(Get-ChildItem -LiteralPath $payloadRoot -File -Recurse | ForEach-Object {
  $_.FullName.Substring($payloadRoot.Length).TrimStart('\').Replace('\', '/')
} | Sort-Object)
if (-not $managedFiles.Count) { throw 'Payload-ul update-ului este gol.' }

$summary = (& git.exe log -1 --pretty=%s).Trim()
$builtAt = (Get-Date).ToUniversalTime().ToString('o')
$internalManifest = [ordered]@{
  format = 'rx-ai-studio-continuous-update'
  schemaVersion = 1
  channel = 'main'
  commit = $commit
  appVersion = $appVersion
  minimumBootstrapVersion = '1.1.3'
  builtAt = $builtAt
  summary = $summary
  files = $managedFiles
}
$internalManifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $bundleRoot 'update-manifest.json') -Encoding UTF8

$zipName = "RX-AI-Studio-Continuous-Update-$shortCommit.zip"
$zipPath = Join-Path $distRoot $zipName
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Invoke-Checked -Command tar.exe -Arguments @('-a', '-c', '-f', $zipPath, '-C', $bundleRoot, 'update-manifest.json', 'payload')

$zipInfo = Get-Item -LiteralPath $zipPath
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$publicManifest = [ordered]@{
  format = 'rx-ai-studio-continuous-update'
  schemaVersion = 1
  channel = 'main'
  commit = $commit
  appVersion = $appVersion
  minimumBootstrapVersion = '1.1.3'
  builtAt = $builtAt
  summary = $summary
  package = [ordered]@{
    name = $zipName
    size = [long]$zipInfo.Length
    sha256 = $zipHash
  }
}
$manifestPath = Join-Path $distRoot 'rx-update-manifest.json'
$publicManifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Pachet update continuu: $zipPath" -ForegroundColor Green
Write-Host "Manifest: $manifestPath" -ForegroundColor Green
Write-Host "Commit: $commit / SHA256: $zipHash / fisiere: $($managedFiles.Count)" -ForegroundColor Green
