[CmdletBinding()]
param(
  [switch]$SkipDependencyRefresh
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$appVersion = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json).version
if ($appVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Versiune invalida in package.json: $appVersion" }
$installerRoot = Join-Path $projectRoot 'installer'
$offlineRoot = Join-Path $installerRoot '.offline-staging'
$stagingRoot = Join-Path $offlineRoot 'app'
$prerequisiteRoot = Join-Path $offlineRoot 'prerequisites'
$packageRoot = Join-Path $installerRoot ".offline-package\RX-AI-Studio-Offline-$appVersion"
$scriptPath = Join-Path $installerRoot 'RX-AI-Studio-Offline.iss'
$distRoot = Join-Path $installerRoot 'dist'

function Invoke-Checked {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(ValueFromRemainingArguments)][string[]]$Arguments
  )
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Comanda a esuat cu codul ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
  }
}

function Reset-ChildDirectory {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Parent)
  $resolvedPath = [IO.Path]::GetFullPath($Path)
  $resolvedParent = [IO.Path]::GetFullPath($Parent)
  if (-not $resolvedPath.StartsWith($resolvedParent, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Folder temporar invalid: $resolvedPath"
  }
  if (Test-Path -LiteralPath $resolvedPath) {
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
  }
  New-Item -ItemType Directory -Path $resolvedPath -Force | Out-Null
}

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

if (-not $SkipDependencyRefresh) {
  Invoke-Checked npm.cmd ci
  Invoke-Checked npm.cmd --prefix dashboard-v2 ci
  Invoke-Checked npm.cmd --prefix property-copywriter ci
  Invoke-Checked npm.cmd --prefix overlay-desktop ci
}

Invoke-Checked npm.cmd run build
Invoke-Checked npm.cmd --prefix property-copywriter run build
Invoke-Checked npm.cmd run overlay:dist
Invoke-Checked npm.cmd run launcher:dist

Reset-ChildDirectory -Path $offlineRoot -Parent $installerRoot
New-Item -ItemType Directory -Path $stagingRoot, $prerequisiteRoot -Force | Out-Null

$trackedFiles = & git.exe ls-files --cached --others --exclude-standard
if ($LASTEXITCODE -ne 0) { throw 'Nu am putut inventaria fisierele urmarite de Git.' }
foreach ($relativePath in $trackedFiles) {
  if ([string]::IsNullOrWhiteSpace($relativePath)) { continue }
  $sourcePath = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
  $destinationPath = Join-Path $stagingRoot $relativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

$dependencyDirectories = @(
  'node_modules',
  'dashboard-v2\node_modules',
  'property-copywriter\node_modules',
  'overlay-desktop\node_modules',
  'dashboard-v2\dist',
  'property-copywriter\.next',
  'overlay-desktop\dist',
  'overlay-desktop\launcher\dist'
)
foreach ($relativePath in $dependencyDirectories) {
  $sourcePath = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Lipseste outputul obligatoriu: $relativePath" }
  $destinationPath = Join-Path $stagingRoot $relativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
}

# Next keeps large development/Turbopack caches beside the production output.
# They are machine-specific and are never needed by `next start` in the offline install.
$nextTransientPaths = @(
  (Join-Path $stagingRoot 'property-copywriter\.next\dev'),
  (Join-Path $stagingRoot 'property-copywriter\.next\cache')
)
foreach ($transientPath in $nextTransientPaths) {
  if (Test-Path -LiteralPath $transientPath) {
    Remove-Item -LiteralPath $transientPath -Recurse -Force
  }
}

$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$nodeSourceRoot = Split-Path -Parent $nodeExecutable
$nodeDestinationRoot = Join-Path $stagingRoot 'runtime\node'
New-Item -ItemType Directory -Path $nodeDestinationRoot -Force | Out-Null
Get-ChildItem -LiteralPath $nodeSourceRoot -Force | Copy-Item -Destination $nodeDestinationRoot -Recurse -Force

$browserRoot = Join-Path $stagingRoot 'runtime\ms-playwright'
$previousBrowserPath = $env:PLAYWRIGHT_BROWSERS_PATH
try {
  $env:PLAYWRIGHT_BROWSERS_PATH = $browserRoot
  Invoke-Checked npx.cmd playwright install chromium
  Invoke-Checked npm.cmd --prefix property-copywriter exec -- playwright install chromium
} finally {
  $env:PLAYWRIGHT_BROWSERS_PATH = $previousBrowserPath
}

$marker = [ordered]@{
  format = 'rx-ai-studio-offline-bundle'
  version = 1
  appVersion = $appVersion
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  nodeVersion = (& $nodeExecutable --version).Trim()
}
$marker | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stagingRoot 'runtime\offline-bundle.json') -Encoding UTF8

Invoke-Checked powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $stagingRoot 'installer\install-rx-studio-offline.ps1') -InstallRoot $stagingRoot -VerifyOnly

$redistPath = Join-Path $prerequisiteRoot 'vc_redist.x64.exe'
Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile $redistPath
$redistSignature = Get-AuthenticodeSignature -LiteralPath $redistPath
if ($redistSignature.Status -ne 'Valid' -or $redistSignature.SignerCertificate.Subject -notmatch 'Microsoft') {
  throw 'Semnatura Microsoft Visual C++ Redistributable nu este valida.'
}

New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
Invoke-Checked $compiler "/DMyAppVersion=$appVersion" $scriptPath

$setupName = "RX-AI-Studio-Offline-Setup-$appVersion.exe"
$setupPath = Join-Path $distRoot $setupName
if (-not (Test-Path -LiteralPath $setupPath)) { throw 'Installerul offline nu a fost generat.' }

Reset-ChildDirectory -Path $packageRoot -Parent (Join-Path $installerRoot '.offline-package')
Copy-Item -LiteralPath $setupPath -Destination $packageRoot -Force
Copy-Item -LiteralPath (Join-Path $installerRoot 'OFFLINE-README.txt') -Destination $packageRoot -Force
$setupHash = (Get-FileHash -LiteralPath $setupPath -Algorithm SHA256).Hash
"$setupHash  $setupName" |
  Set-Content -LiteralPath (Join-Path $packageRoot 'SHA256.txt') -Encoding ASCII
"$setupHash  $setupName" |
  Set-Content -LiteralPath "$setupPath.sha256" -Encoding ASCII

$zipPath = Join-Path $distRoot "RX-AI-Studio-Offline-$appVersion.zip"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $packageRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal

$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
Write-Host "Installer offline: $setupPath" -ForegroundColor Green
Write-Host "Arhiva portabila: $zipPath" -ForegroundColor Green
Write-Host "SHA256 ZIP: $zipHash" -ForegroundColor Green
