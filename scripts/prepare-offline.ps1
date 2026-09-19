$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$cacheRoot = Join-Path $projectRoot '.build-cache'
$electronCache = Join-Path $cacheRoot 'electron'
$builderCache = Join-Path $cacheRoot 'electron-builder'
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$sourceElectronCache = Join-Path $localAppData 'electron\Cache'
$sourceBuilderCache = Join-Path $localAppData 'electron-builder\Cache'

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
  throw 'node_modules is missing. Run npm.cmd ci while online first.'
}

if (-not (Test-Path -LiteralPath $sourceElectronCache)) {
  throw "Electron cache is missing: $sourceElectronCache. Run npm.cmd run dist while online first."
}

if (-not (Test-Path -LiteralPath $sourceBuilderCache)) {
  throw "electron-builder cache is missing: $sourceBuilderCache. Run npm.cmd run dist while online first."
}

New-Item -ItemType Directory -Force -Path $electronCache, $builderCache | Out-Null
Copy-Item -Path (Join-Path $sourceElectronCache '*') -Destination $electronCache -Recurse -Force
Copy-Item -Path (Join-Path $sourceBuilderCache '*') -Destination $builderCache -Recurse -Force

$electronZip = Get-ChildItem -LiteralPath $electronCache -Recurse -Filter 'electron-v34.5.8-win32-x64.zip' -File | Select-Object -First 1
$sevenZip = Get-ChildItem -LiteralPath $builderCache -Recurse -Filter '7zip-win-x64.tar.gz' -File | Select-Object -First 1
$nsis = Get-ChildItem -LiteralPath $builderCache -Recurse -Filter 'nsis-3.0.4.1.7z' -File | Select-Object -First 1

if (-not $electronZip -or -not $sevenZip -or -not $nsis) {
  throw 'Offline cache is incomplete. Electron 34.5.8, 7zip, and NSIS are required.'
}

Write-Host 'Offline build cache is ready.'
Write-Host "Cache root: $cacheRoot"
Write-Host "Electron:   $($electronZip.FullName)"
Write-Host "7zip:       $($sevenZip.FullName)"
Write-Host "NSIS:       $($nsis.FullName)"
Write-Host 'Copy the project directory, including node_modules and .build-cache, to the offline machine.'
