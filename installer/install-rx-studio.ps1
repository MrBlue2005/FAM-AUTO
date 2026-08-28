[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$InstallRoot,
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Invoke-Checked {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(ValueFromRemainingArguments)][string[]]$Arguments
  )

  Write-Host "`n> $Command $($Arguments -join ' ')" -ForegroundColor Cyan
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Comanda a esuat cu codul ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
  }
}

$resolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$expectedLocalPrograms = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs'))
if (-not $resolvedInstallRoot.StartsWith($expectedLocalPrograms, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Folderul de instalare trebuie sa ramana in $expectedLocalPrograms"
}

$nodeRoot = Join-Path $resolvedInstallRoot 'runtime\node'
$nodeExecutable = Join-Path $nodeRoot 'node.exe'
$minimumNodeVersion = [version]'22.12.0'
$needsNode = -not (Test-Path -LiteralPath $nodeExecutable)

if (-not $needsNode) {
  try {
    $installedVersion = [version]((& $nodeExecutable --version).TrimStart('v'))
    $needsNode = $installedVersion -lt $minimumNodeVersion
  } catch {
    $needsNode = $true
  }
}

if ($needsNode) {
  if (Test-Path -LiteralPath $nodeRoot) {
    throw "Runtime-ul Node existent este invalid sau prea vechi: $nodeRoot. Dezinstaleaza RX AI Studio si ruleaza din nou setup-ul."
  }

  Write-Host 'Descarc runtime-ul Node.js 22 pentru RX AI Studio...' -ForegroundColor Green
  $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
  $release = $releases | Where-Object {
    $_.version -match '^v22\.' -and $_.files -contains 'win-x64-zip'
  } | Select-Object -First 1
  if (-not $release) {
    throw 'Nu am gasit o versiune Node.js 22 pentru Windows x64.'
  }

  $archiveName = "node-$($release.version)-win-x64.zip"
  $downloadUri = "https://nodejs.org/dist/$($release.version)/$archiveName"
  $checksumsUri = "https://nodejs.org/dist/$($release.version)/SHASUMS256.txt"
  $temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("rx-ai-installer-" + [guid]::NewGuid().ToString('N'))
  $archivePath = Join-Path $temporaryRoot $archiveName
  $extractPath = Join-Path $temporaryRoot 'extract'

  try {
    New-Item -ItemType Directory -Path $extractPath -Force | Out-Null
    Invoke-WebRequest -Uri $downloadUri -OutFile $archivePath
    $checksums = Invoke-RestMethod -Uri $checksumsUri
    $expectedChecksumLine = ($checksums -split "`n") | Where-Object { $_ -match "\s+$([regex]::Escape($archiveName))\s*$" } | Select-Object -First 1
    if (-not $expectedChecksumLine) {
      throw "Nu am gasit checksum-ul oficial pentru $archiveName."
    }
    $expectedChecksum = ($expectedChecksumLine -split '\s+')[0].Trim().ToLowerInvariant()
    $actualChecksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualChecksum -ne $expectedChecksum) {
      throw 'Verificarea SHA-256 a runtime-ului Node.js a esuat.'
    }
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
    $expandedNodeRoot = Get-ChildItem -LiteralPath $extractPath -Directory | Select-Object -First 1
    if (-not $expandedNodeRoot -or -not (Test-Path -LiteralPath (Join-Path $expandedNodeRoot.FullName 'node.exe'))) {
      throw 'Arhiva Node.js descarcata nu are structura asteptata.'
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $nodeRoot) -Force | Out-Null
    Move-Item -LiteralPath $expandedNodeRoot.FullName -Destination $nodeRoot
  } finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
      Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
  }
}

$env:Path = "$nodeRoot;$env:Path"
$env:RX_NODE_EXE = $nodeExecutable
Set-Location -LiteralPath $resolvedInstallRoot

$setupArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $resolvedInstallRoot 'scripts\setup-new-pc.ps1'))
if ($SkipChecks) { $setupArguments += '-SkipChecks' }
Invoke-Checked powershell.exe @setupArguments

$installedVersion = (& $nodeExecutable --version).Trim()
Write-Host "`nRX AI Studio a fost instalat cu Node.js $installedVersion." -ForegroundColor Green
Write-Host 'Poti porni aplicatia din shortcutul RX AI Studio de pe Desktop.' -ForegroundColor Green
