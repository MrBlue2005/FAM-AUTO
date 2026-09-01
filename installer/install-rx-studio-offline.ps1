[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$InstallRoot,
  [switch]$SkipChecks,
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'

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
if (-not $VerifyOnly -and -not $resolvedInstallRoot.StartsWith($expectedLocalPrograms, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Folderul de instalare trebuie sa ramana in $expectedLocalPrograms"
}

$nodeRoot = Join-Path $resolvedInstallRoot 'runtime\node'
$nodeExecutable = Join-Path $nodeRoot 'node.exe'
$browserRoot = Join-Path $resolvedInstallRoot 'runtime\ms-playwright'
$offlineMarker = Join-Path $resolvedInstallRoot 'runtime\offline-bundle.json'
$requiredPaths = @(
  $nodeExecutable,
  (Join-Path $nodeRoot 'npm.cmd'),
  $browserRoot,
  $offlineMarker,
  (Join-Path $resolvedInstallRoot 'node_modules'),
  (Join-Path $resolvedInstallRoot 'dashboard-v2\node_modules'),
  (Join-Path $resolvedInstallRoot 'property-copywriter\node_modules'),
  (Join-Path $resolvedInstallRoot 'overlay-desktop\node_modules'),
  (Join-Path $resolvedInstallRoot 'overlay-desktop\dist'),
  (Join-Path $resolvedInstallRoot 'overlay-desktop\launcher\dist')
)
$missingPaths = $requiredPaths | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missingPaths) {
  throw "Pachetul offline este incomplet. Lipsesc: $($missingPaths -join ', ')"
}

$chromiumExecutables = Get-ChildItem -LiteralPath $browserRoot -Filter chrome.exe -File -Recurse -ErrorAction SilentlyContinue
if (-not $chromiumExecutables) {
  throw 'Pachetul offline nu contine browserul Chromium necesar robotului.'
}

$nodeVersion = [version]((& $nodeExecutable --version).TrimStart('v'))
if ($nodeVersion -lt [version]'22.12.0') {
  throw "Runtime Node incompatibil in pachetul offline: $nodeVersion"
}

if ($VerifyOnly) {
  Write-Host "Pachet offline valid: Node.js $nodeVersion, Chromium inclus, dependente si aplicatii precompilate prezente." -ForegroundColor Green
  exit 0
}

$env:Path = "$nodeRoot;$env:Path"
$env:RX_NODE_EXE = $nodeExecutable
$env:PLAYWRIGHT_BROWSERS_PATH = $browserRoot
Set-Location -LiteralPath $resolvedInstallRoot

$templates = @(
  @{ Source = '.env.example'; Destination = '.env' },
  @{ Source = 'dashboard-v2/.env.example'; Destination = 'dashboard-v2/.env' },
  @{ Source = 'property-copywriter/.env.example'; Destination = 'property-copywriter/.env' }
)
foreach ($template in $templates) {
  if (-not (Test-Path -LiteralPath $template.Destination)) {
    Copy-Item -LiteralPath $template.Source -Destination $template.Destination
  }
}

$sqlitePath = Join-Path $resolvedInstallRoot 'property-copywriter\dev.db'
if (-not (Test-Path -LiteralPath $sqlitePath)) {
  New-Item -ItemType File -Path $sqlitePath | Out-Null
}
Invoke-Checked npm.cmd --prefix property-copywriter run db:push

$existingPasswordHash = Select-String -LiteralPath '.env' -Pattern '^ADMIN_PASSWORD_SCRYPT=.+$' -Quiet
if (-not $existingPasswordHash) {
  $securePassword = Read-Host 'Alege parola administratorului (minimum 16 caractere)' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $env:PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    Invoke-Checked npm.cmd run auth:setup
  } finally {
    Remove-Item Env:PASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
}

if (-not $SkipChecks) {
  Invoke-Checked node.exe --check server/server.js
  Invoke-Checked npm.cmd test
  Invoke-Checked npm.cmd --prefix property-copywriter test
}

Invoke-Checked powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $resolvedInstallRoot 'scripts\install-studio-launcher.ps1')

Write-Host "`nRX AI Studio offline a fost instalat complet cu Node.js $nodeVersion." -ForegroundColor Green
Write-Host 'Nu sunt necesare Visual Studio, Node.js global sau descarcari npm/Playwright.' -ForegroundColor Green
Write-Host 'Porneste aplicatia din shortcutul RX AI Studio de pe Desktop.' -ForegroundColor Green
