[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$installerRoot = Join-Path $projectRoot 'installer'
$stagingRoot = Join-Path $installerRoot '.staging\app'
$scriptPath = Join-Path $installerRoot 'RX-AI-Studio.iss'

Set-Location -LiteralPath $projectRoot

$compilerCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
)
$compiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $compiler) {
  $compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $compiler) {
  throw 'Lipseste Inno Setup 6. Instaleaza-l cu: winget install --id JRSoftware.InnoSetup -e'
}

if (Test-Path -LiteralPath $stagingRoot) {
  $resolvedStagingRoot = [IO.Path]::GetFullPath($stagingRoot)
  $resolvedInstallerRoot = [IO.Path]::GetFullPath($installerRoot)
  if (-not $resolvedStagingRoot.StartsWith($resolvedInstallerRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Folder staging invalid: $resolvedStagingRoot"
  }
  Remove-Item -LiteralPath $resolvedStagingRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

$trackedAndNewFiles = & git.exe ls-files --cached --others --exclude-standard
if ($LASTEXITCODE -ne 0) { throw 'Nu am putut inventaria fisierele proiectului cu Git.' }

foreach ($relativePath in $trackedAndNewFiles) {
  if ([string]::IsNullOrWhiteSpace($relativePath)) { continue }
  $sourcePath = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
  $destinationPath = Join-Path $stagingRoot $relativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

Write-Host "Construiesc installerul RX AI Studio..." -ForegroundColor Cyan
& $compiler $scriptPath
if ($LASTEXITCODE -ne 0) {
  throw "Compilarea installerului a esuat cu codul $LASTEXITCODE."
}

$output = Get-ChildItem -LiteralPath (Join-Path $installerRoot 'dist') -Filter 'RX-AI-Studio-Setup-*.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $output) { throw 'Installerul compilat nu a fost gasit.' }

Write-Host ("Installer creat: {0}" -f $output.FullName) -ForegroundColor Green
