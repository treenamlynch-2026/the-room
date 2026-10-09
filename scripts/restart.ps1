# Safe update: stop every Room server process, rebuild, start ONE fresh server, verify it serves the new build.
# Usage (from the project folder):  npm run restart        (skip the build: npm run restart -- -SkipBuild)
param([switch]$SkipBuild, [int]$Port = 3000)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Stop-RoomServers {
  # Whatever listens on the port, plus any leftover `next start` / `next dev` node process for that port
  # (an old process can survive a crashed terminal and keep holding connections).
  $pids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess)
  $pids += @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'next[\\/]dist[\\/]bin[\\/]next"?\s+(start|dev)' -and $_.CommandLine -notmatch '(-p|--port)\s+(?!3000\b)\d+' } |
    Select-Object -ExpandProperty ProcessId)
  foreach ($p in ($pids | Where-Object { $_ } | Sort-Object -Unique)) {
    Write-Host "Stopping server process $p"
    & taskkill /PID $p /T /F 2>$null | Out-Null
  }
  for ($i = 0; $i -lt 20 -and (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 250 }
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port is still in use after stopping servers." }
}

Stop-RoomServers
if (-not $SkipBuild) {
  $env:ROOM_RESTARTING = "1"   # tells the prebuild guard the server was stopped on purpose
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed: server NOT restarted. Fix the build and run again." }
  Remove-Item Env:ROOM_RESTARTING
}
$want = (Get-Content (Join-Path $root ".next\BUILD_ID") -Raw).Trim()
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm start >> room.log 2>&1" -WorkingDirectory $root -WindowStyle Hidden
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try { $h = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2 } catch { continue }
  if ($h.buildId -ne $want) { throw "Server answered with build $($h.buildId), expected $want." }
  Write-Host "The Room is up on http://127.0.0.1:$Port (build $want, pid $($h.pid)). Open tabs pick up the new build automatically."
  exit 0
}
throw "Server did not come up within 30s: check room.log."
