$ErrorActionPreference = 'Stop'

function Get-NpmCommand {
  if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    return 'npm.cmd'
  }
  return 'npm'
}

$rootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$workDir = Join-Path $PSScriptRoot 'work'
$payloadRoot = Join-Path $workDir 'payload'
$sfxSource = Join-Path $workDir 'sfx'
$releaseDir = Join-Path $rootDir 'release'
$payloadZip = Join-Path $sfxSource 'payload.zip'
$portableZip = Join-Path $releaseDir 'CanCan-Campus-Radio-Windows-Portable.zip'
$targetExe = Join-Path $releaseDir 'CanCan-Campus-Radio.exe'
$sfxSourceFile = Join-Path $PSScriptRoot 'CanCanSfx.cs'

Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $payloadRoot, $sfxSource, $releaseDir | Out-Null

$appDir = Join-Path $payloadRoot 'app'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null

foreach ($dir in @('server', 'public', 'scripts', 'data', 'cache')) {
  $source = Join-Path $rootDir $dir
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $appDir $dir) -Recurse
  }
}

foreach ($file in @('package.json', 'start.mjs', '.env.local', '.env.example', 'README.md', 'netease_cookie.txt', 'fresh_token.txt')) {
  $source = Join-Path $rootDir $file
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $appDir $file)
  }
}

$portableNpmDir = Join-Path $appDir 'npm'
New-Item -ItemType Directory -Force -Path $portableNpmDir | Out-Null
& (Get-NpmCommand) install --prefix $portableNpmDir NeteaseCloudMusicApi --omit=dev

$nodePath = (Get-Command node).Source
$runtimeDir = Join-Path $payloadRoot 'runtime'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $runtimeDir 'node.exe')

New-Item -ItemType Directory -Force -Path (Join-Path $payloadRoot 'launcher') | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launcher\launch-release.mjs') -Destination (Join-Path $payloadRoot 'launcher\launch-release.mjs')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launcher\start-release.bat') -Destination (Join-Path $payloadRoot 'launcher\start-release.bat')
Copy-Item -LiteralPath (Join-Path $payloadRoot 'launcher\start-release.bat') -Destination (Join-Path $payloadRoot 'start-release.bat')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'PORTABLE-USAGE.txt') -Destination (Join-Path $payloadRoot 'README-FIRST.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'PORTABLE-USAGE.txt') -Destination (Join-Path $releaseDir 'README-FIRST.txt')

Remove-Item -LiteralPath $payloadZip, $portableZip, $targetExe -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $payloadRoot '*') -DestinationPath $payloadZip -Force
Compress-Archive -Path (Join-Path $payloadRoot '*') -DestinationPath $portableZip -Force

$cscCandidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$csc) {
  throw 'C# compiler was not found. Expected .NET Framework csc.exe on this Windows machine.'
}

& $csc `
  /nologo `
  /target:winexe `
  /platform:anycpu `
  /optimize+ `
  "/out:$targetExe" `
  "/resource:$payloadZip,payload.zip" `
  /reference:System.IO.Compression.dll `
  /reference:System.IO.Compression.FileSystem.dll `
  /reference:System.Windows.Forms.dll `
  $sfxSourceFile

if (!(Test-Path -LiteralPath $targetExe)) {
  throw "SFX compiler did not create $targetExe"
}

Get-Item -LiteralPath $targetExe, $portableZip |
  Select-Object FullName, Length, LastWriteTime
