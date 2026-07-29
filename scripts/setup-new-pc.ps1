[CmdletBinding()]
param(
  [switch]$NonInteractive,
  [switch]$SkipBrowserInstall,
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

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

foreach ($requiredCommand in @('git.exe', 'node.exe', 'npm.cmd')) {
  if (-not (Get-Command $requiredCommand -ErrorAction SilentlyContinue)) {
    throw "Lipseste $requiredCommand. Instaleaza Git si Node.js 22.12+ si redeschide terminalul."
  }
}

$nodeVersionText = (& node.exe --version).TrimStart('v')
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion -lt [version]'22.12.0') {
  throw "Node.js $nodeVersionText este prea vechi. Este necesar Node.js 22.12.0 sau mai nou."
}

Write-Host "Configurare RX AI Studio cu Node.js $nodeVersionText" -ForegroundColor Green

Invoke-Checked npm.cmd ci
Invoke-Checked npm.cmd --prefix dashboard-v2 ci
Invoke-Checked npm.cmd --prefix property-copywriter ci
Invoke-Checked npm.cmd --prefix overlay-desktop ci

$templates = @(
  @{ Source = '.env.example'; Destination = '.env' },
  @{ Source = 'dashboard-v2/.env.example'; Destination = 'dashboard-v2/.env' },
  @{ Source = 'property-copywriter/.env.example'; Destination = 'property-copywriter/.env' }
)
foreach ($template in $templates) {
  if (-not (Test-Path -LiteralPath $template.Destination)) {
    Copy-Item -LiteralPath $template.Source -Destination $template.Destination
    Write-Host "Creat $($template.Destination) din exemplul sigur."
  } else {
    Write-Host "Pastrez configuratia locala existenta: $($template.Destination)"
  }
}

$sqlitePath = Join-Path $projectRoot 'property-copywriter\dev.db'
if (-not (Test-Path -LiteralPath $sqlitePath)) {
  New-Item -ItemType File -Path $sqlitePath | Out-Null
  Write-Host 'Creat baza SQLite locala goala pentru initializarea Prisma.'
}
Invoke-Checked npm.cmd --prefix property-copywriter run db:push

if (-not $SkipBrowserInstall) {
  Invoke-Checked npx.cmd playwright install chromium
  Invoke-Checked npm.cmd --prefix property-copywriter exec -- playwright install chromium
}

if (-not $NonInteractive) {
  $securePassword = Read-Host 'Alege parola administratorului (minimum 16 caractere)' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $env:PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    Invoke-Checked npm.cmd run auth:setup
  } finally {
    Remove-Item Env:PASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
} else {
  Write-Host 'Mod non-interactiv: autentificarea nu a fost modificata. Ruleaza npm.cmd run auth:setup pentru a seta parola.' -ForegroundColor Yellow
}

if (-not $SkipChecks) {
  Invoke-Checked npm.cmd test
  Invoke-Checked npm.cmd --prefix dashboard-v2 run lint
  Invoke-Checked npm.cmd --prefix property-copywriter test
  Invoke-Checked npm.cmd --prefix property-copywriter run typecheck
}

Write-Host "`nInstalarea este gata. Porneste toate aplicatiile cu: npm.cmd run studio" -ForegroundColor Green
Write-Host 'Deschide apoi: http://127.0.0.1:5173'