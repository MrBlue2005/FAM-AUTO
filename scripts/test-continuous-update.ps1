[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$testParent = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'RX-AI-Studio-Updater-Tests')).TrimEnd('\')
$testRoot = Join-Path $testParent ([guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $testRoot 'install'
$updatesRoot = Join-Path $testRoot 'updates'
$helperPath = Join-Path $projectRoot 'scripts\apply-continuous-update.ps1'

function Reset-TestRoot {
  $resolved = [IO.Path]::GetFullPath($testRoot)
  if (-not $resolved.StartsWith("$testParent\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Folder de test nesigur: $resolved"
  }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
  New-Item -ItemType Directory -Path $installRoot, $updatesRoot -Force | Out-Null
}

function Set-TestFile {
  param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$RelativePath, [Parameter(Mandatory)][string]$Content)
  $path = Join-Path $Root $RelativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
  Set-Content -LiteralPath $path -Value $Content -Encoding UTF8
}

function New-TestPackage {
  param(
    [Parameter(Mandatory)][string]$Commit,
    [Parameter(Mandatory)][System.Collections.IDictionary]$Files,
    [Parameter(Mandatory)][string]$Name
  )
  $bundleRoot = Join-Path $testRoot "bundle-$Name"
  $payloadRoot = Join-Path $bundleRoot 'payload'
  New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
  foreach ($entry in $Files.GetEnumerator()) {
    Set-TestFile -Root $payloadRoot -RelativePath $entry.Key -Content $entry.Value
  }
  $manifest = [ordered]@{
    format = 'rx-ai-studio-continuous-update'
    schemaVersion = 1
    channel = 'test'
    commit = $Commit
    appVersion = '1.1.3'
    minimumBootstrapVersion = '1.1.3'
    builtAt = (Get-Date).ToUniversalTime().ToString('o')
    summary = 'Updater helper test'
    files = @($Files.Keys)
  }
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $bundleRoot 'update-manifest.json') -Encoding UTF8
  $packagePath = Join-Path $testRoot "$Name.zip"
  & tar.exe -a -c -f $packagePath -C $bundleRoot update-manifest.json payload
  if ($LASTEXITCODE -ne 0) { throw 'Arhiva de test nu a putut fi creata.' }
  return [pscustomobject]@{
    Path = $packagePath
    Hash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
    Commit = $Commit
  }
}

function Invoke-TestUpdate {
  param([Parameter(Mandatory)]$Package)
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helperPath `
    -InstallRoot $installRoot `
    -PackagePath $Package.Path `
    -ExpectedSha256 $Package.Hash `
    -ExpectedCommit $Package.Commit `
    -ParentProcessId 999999 `
    -RestartLauncherRelativePath 'restart.cmd' `
    -UpdatesRoot $updatesRoot
  return $LASTEXITCODE
}

Reset-TestRoot
try {
  Set-TestFile -Root $installRoot -RelativePath 'package.json' -Content '{"name":"facebook-automation","version":"1.1.3"}'
  Set-TestFile -Root $installRoot -RelativePath 'app\existing.txt' -Content 'old-value'
  Set-TestFile -Root $installRoot -RelativePath '.env' -Content 'GEMINI_API_KEY=must-stay-local'
  Set-TestFile -Root $installRoot -RelativePath 'app\data\groups.json' -Content '[{"private":true}]'

  $successCommit = 'e' * 40
  $successPackage = New-TestPackage -Commit $successCommit -Name 'success' -Files ([ordered]@{
    'package.json' = '{"name":"facebook-automation","version":"1.1.3"}'
    'app/existing.txt' = 'new-value'
    'restart.cmd' = '@exit /b 0'
  })
  $savedLocalAppData = $env:LOCALAPPDATA
  try {
    $env:LOCALAPPDATA = Join-Path $testRoot 'local-app-data'
    New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force | Out-Null
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helperPath `
      -InstallRoot $installRoot `
      -PackagePath $successPackage.Path `
      -ExpectedSha256 $successPackage.Hash `
      -ExpectedCommit $successPackage.Commit `
      -ParentProcessId 999999 `
      -RestartLauncherRelativePath 'restart.cmd' `
      -VerifyOnly
    if ($LASTEXITCODE -ne 0) { throw 'Validarea cu folderul implicit de productie a esuat.' }
  } finally {
    $env:LOCALAPPDATA = $savedLocalAppData
  }
  if ((Invoke-TestUpdate -Package $successPackage) -ne 0) { throw 'Aplicarea pachetului valid a esuat.' }
  if ((Get-Content -Raw -LiteralPath (Join-Path $installRoot 'app\existing.txt')).Trim() -ne 'new-value') { throw 'Fisierul administrat nu a fost actualizat.' }
  if ((Get-Content -Raw -LiteralPath (Join-Path $installRoot '.env')).Trim() -ne 'GEMINI_API_KEY=must-stay-local') { throw 'Fisierul .env nu a fost pastrat.' }
  if ((Get-Content -Raw -LiteralPath (Join-Path $installRoot 'app\data\groups.json')).Trim() -ne '[{"private":true}]') { throw 'Datele operationale nu au fost pastrate.' }
  $state = Get-Content -Raw -LiteralPath (Join-Path $installRoot '.rx-update-state.json') | ConvertFrom-Json
  if ($state.commit -ne $successCommit) { throw 'Commitul aplicat nu a fost salvat in starea updaterului.' }

  Set-TestFile -Root $installRoot -RelativePath 'blocked' -Content 'parent-is-a-file'
  $failureCommit = 'f' * 40
  $failurePackage = New-TestPackage -Commit $failureCommit -Name 'rollback' -Files ([ordered]@{
    'app/existing.txt' = 'must-be-rolled-back'
    'blocked/child.txt' = 'copy-must-fail'
  })
  if ((Invoke-TestUpdate -Package $failurePackage) -eq 0) { throw 'Pachetul de rollback trebuia sa esueze.' }
  if ((Get-Content -Raw -LiteralPath (Join-Path $installRoot 'app\existing.txt')).Trim() -ne 'new-value') { throw 'Rollback-ul nu a restaurat fisierul suprascris.' }
  $stateAfterRollback = Get-Content -Raw -LiteralPath (Join-Path $installRoot '.rx-update-state.json') | ConvertFrom-Json
  if ($stateAfterRollback.commit -ne $successCommit) { throw 'Rollback-ul nu a restaurat starea updaterului.' }

  Write-Host 'Updater helper: apply, local-data preservation and rollback tests passed.' -ForegroundColor Green
} finally {
  $resolved = [IO.Path]::GetFullPath($testRoot)
  if ($resolved.StartsWith("$testParent\", [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolved)) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
