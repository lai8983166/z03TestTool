$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$cacheRoot = Join-Path $projectRoot '.build-cache'
$electronCache = Join-Path $cacheRoot 'electron'
$builderCache = Join-Path $cacheRoot 'electron-builder'

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
  throw 'node_modules is missing. Copy the prepared node_modules from an online machine.'
}

$electronZip = Get-ChildItem -LiteralPath $electronCache -Recurse -Filter 'electron-v34.5.8-win32-x64.zip' -File -ErrorAction SilentlyContinue | Select-Object -First 1
$sevenZip = Get-ChildItem -LiteralPath $builderCache -Recurse -Filter '7zip-win-x64.tar.gz' -File -ErrorAction SilentlyContinue | Select-Object -First 1
$nsis = Get-ChildItem -LiteralPath $builderCache -Recurse -Filter 'nsis-3.0.4.1.7z' -File -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $electronZip -or -not $sevenZip -or -not $nsis) {
  throw 'Offline cache is incomplete. Run npm.cmd run prepare:offline on an online machine first.'
}

$env:ELECTRON_CACHE = $electronCache
$env:ELECTRON_BUILDER_CACHE = $builderCache

Push-Location $projectRoot
try {
  & npm.cmd run dist
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}
