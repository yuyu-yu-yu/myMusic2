---
name: cancan-release-packager
description: Rebuild and verify the CanCan Campus Radio Windows release package. Use when the user asks to 打包, 重新打包, update exe/zip, rebuild the Windows demo release, slim the release package, or prepare GitHub Release artifacts for this myMusic2 project.
---

# CanCan Release Packager

Use this skill to rebuild the Windows competition/demo release for `C:\myMusic2`.

The expected outputs are:

- `C:\myMusic2\release\CanCan-Campus-Radio.exe`
- `C:\myMusic2\release\CanCan-Campus-Radio-Windows-Portable.zip`

## Workflow

Run steps sequentially. Do not run tests and packaging in parallel: packaging creates `packaging\work\payload`, and tests can accidentally resolve modules from that payload if the environment is polluted.

1. Confirm the working directory is `C:\myMusic2`.
2. Run tests:

```powershell
npm test
```

3. Build the release:

```powershell
& 'C:\myMusic2\packaging\build-release.ps1'
```

4. Smoke-check the packaged payload with bundled Node:

```powershell
$ErrorActionPreference='Stop'
$payload='C:\myMusic2\packaging\work\payload'
$app=Join-Path $payload 'app'
$node=Join-Path $payload 'runtime\node.exe'
$env:APPDATA=$app
$env:PORT='3311'
$env:HOST='127.0.0.1'
$env:COMMUNITY_API_BASE_URL='http://127.0.0.1:4311'
$env:NODE_ENV='production'
$out=Join-Path $payload 'smoke-server.log'
$err=Join-Path $payload 'smoke-server.err.log'
Remove-Item -LiteralPath $out,$err -Force -ErrorAction SilentlyContinue
$p=Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList @('--experimental-sqlite','server\index.mjs') -WorkingDirectory $app -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
try {
  $ok=$false
  for($i=0; $i -lt 50; $i++) {
    if ($p.HasExited) { throw "packaged server exited early with code $($p.ExitCode)" }
    try {
      $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3311/api/health' -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $ok=$true; break }
    } catch {}
    Start-Sleep -Milliseconds 300
  }
  if (-not $ok) { throw 'packaged server health check timed out' }
  Write-Output 'PACKAGED_SERVER_HEALTH_OK'
} finally {
  if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
```

5. Report artifact paths, byte sizes, MiB sizes, timestamps, test result, and health-check result:

```powershell
Get-Item -LiteralPath `
  'C:\myMusic2\release\CanCan-Campus-Radio.exe', `
  'C:\myMusic2\release\CanCan-Campus-Radio-Windows-Portable.zip' |
  Select-Object FullName,Length,@{Name='MiB';Expression={[math]::Round($_.Length/1MB,2)}},LastWriteTime
```

## Packaging Rules

The release should preserve the established competition demo behavior:

- Include `server`, `public`, `scripts`, `data`, `.env.local`, `.env.example`, `README.md`, `start.mjs`, `netease_cookie.txt`, `fresh_token.txt`.
- Include bundled Node runtime as `payload\runtime\node.exe`.
- Install and include local `NeteaseCloudMusicApi` under `payload\app\npm` so evaluator machines do not need to install it globally.
- Include only `cache\tts` from `cache`. Do not package all of `cache`.

The `cache` rule matters. `cache` may contain Chrome profiles, avatar-generation working files, QA contact sheets, rollback zips, screenshots, and logs. These are not needed at runtime and can double the release size. Keeping only `cache\tts` preserves generated voice cache while avoiding development artifacts.

## Expected Size

With the slim cache rule, the exe and zip are normally around 100-110 MiB. If they jump close to 190-210 MiB, inspect `payload\app\cache` first.

Useful inspection commands:

```powershell
$root='C:\myMusic2\packaging\work\payload\app'
Get-ChildItem -LiteralPath $root -Directory | ForEach-Object {
  $sum=(Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Force | Measure-Object Length -Sum).Sum
  [pscustomobject]@{Name=$_.Name; Bytes=$sum; MiB=[math]::Round($sum/1MB,2)}
} | Sort-Object Bytes -Descending
```

```powershell
Get-ChildItem -LiteralPath 'C:\myMusic2\packaging\work\payload\app\cache' -Force |
  Select-Object Name,Mode,LastWriteTime
```

The expected `payload\app\cache` content is only:

- `tts`

## Failure Handling

If `npm test` fails, do not claim the release is verified. Summarize the failing tests and stop unless the user asked to proceed despite failure.

If the health check fails, inspect:

- `C:\myMusic2\packaging\work\payload\smoke-server.log`
- `C:\myMusic2\packaging\work\payload\smoke-server.err.log`

If the port is occupied, retry the health check with another local port and matching `/api/health` URL.

If the release is unexpectedly large, first confirm `packaging\build-release.ps1` copies only `cache\tts`, not the entire `cache` directory.
