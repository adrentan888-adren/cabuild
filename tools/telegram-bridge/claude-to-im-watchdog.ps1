param(
  [switch]$Once,
  [int]$IntervalMinutes = 30,
  [int]$MaxTaskMinutes = 25
)

$ErrorActionPreference = "Continue"

$CtiHome = Join-Path $env:USERPROFILE ".claude-to-im"
$SkillDir = Join-Path $env:USERPROFILE ".codex\skills\claude-to-im"
$RuntimeDir = Join-Path $CtiHome "runtime"
$LogDir = Join-Path $CtiHome "logs"
$StatusFile = Join-Path $RuntimeDir "status.json"
$PidFile = Join-Path $RuntimeDir "bridge.pid"
$WatchdogLog = Join-Path $LogDir "watchdog.log"

function Write-WatchdogLog {
  param([string]$Message)
  New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
  $line = "[{0}] {1}" -f (Get-Date).ToUniversalTime().ToString("s"), $Message
  Add-Content -Path $WatchdogLog -Value $line
  Write-Output $line
}

function Get-Daemons {
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -eq "node.exe" -and
      ($_.CommandLine -match "claude-to-im.*dist.*daemon|dist/daemon\.mjs|dist\\daemon\.mjs")
    }
}

function Get-CodexChildren {
  param([int[]]$ParentIds)
  if (-not $ParentIds -or $ParentIds.Count -eq 0) { return @() }
  Get-CimInstance Win32_Process |
    Where-Object {
      ($_.Name -eq "codex.exe" -and ($ParentIds -contains $_.ParentProcessId)) -or
      ($_.CommandLine -match "\\.codex\\skills\\claude-to-im\\node_modules\\@openai\\codex-win32-x64.*codex\.exe exec")
    }
}

function Stop-ProcessTree {
  param([int[]]$RootPids)
  if (-not $RootPids -or $RootPids.Count -eq 0) { return }

  $all = New-Object System.Collections.Generic.HashSet[int]
  foreach ($pidValue in $RootPids) { [void]$all.Add([int]$pidValue) }

  $changed = $true
  while ($changed) {
    $changed = $false
    $processes = Get-CimInstance Win32_Process
    foreach ($process in $processes) {
      if ($all.Contains([int]$process.ParentProcessId) -and -not $all.Contains([int]$process.ProcessId)) {
        [void]$all.Add([int]$process.ProcessId)
        $changed = $true
      }
    }
  }

  foreach ($pidValue in @($all.ToArray() | Sort-Object -Descending)) {
    try { Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue } catch {}
  }
}

function Start-Bridge {
  New-Item -ItemType Directory -Path $RuntimeDir, $LogDir -Force | Out-Null
  Remove-Item $StatusFile -Force -ErrorAction SilentlyContinue
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue

  $env:CTI_HOME = $CtiHome
  $proc = Start-Process `
    -FilePath "node.exe" `
    -ArgumentList "dist/daemon.mjs" `
    -WorkingDirectory $SkillDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir "bridge.out.log") `
    -RedirectStandardError (Join-Path $LogDir "bridge.err.log") `
    -PassThru

  Set-Content -Path $PidFile -Value $proc.Id
  Start-Sleep -Seconds 6
  $duplicates = @(Get-Daemons | Where-Object { $_.ProcessId -ne $proc.Id })
  foreach ($duplicate in $duplicates) {
    try { Stop-Process -Id $duplicate.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
  Write-WatchdogLog "Started Claude-to-IM daemon PID $($proc.Id)."
}

function Test-StatusHealthy {
  if (-not (Test-Path $StatusFile)) { return $false }
  try {
    $status = Get-Content $StatusFile -Raw | ConvertFrom-Json
    if ($status.running -ne $true) { return $false }
    if (-not $status.pid) { return $false }
    return [bool](Get-Process -Id ([int]$status.pid) -ErrorAction SilentlyContinue)
  } catch {
    return $false
  }
}

function Invoke-WatchdogCheck {
  $daemons = @(Get-Daemons)
  $daemonPids = @($daemons | Select-Object -ExpandProperty ProcessId)
  $codexChildren = @(Get-CodexChildren -ParentIds $daemonPids)
  $oldCodexChildren = @($codexChildren | Where-Object {
    $_.CreationDate -and (((Get-Date) - $_.CreationDate).TotalMinutes -gt $MaxTaskMinutes)
  })

  $reasons = @()
  if ($daemons.Count -eq 0) { $reasons += "no daemon process" }
  if ($daemons.Count -gt 1) { $reasons += "duplicate daemon processes: $($daemonPids -join ', ')" }
  if (-not (Test-StatusHealthy)) { $reasons += "status file unhealthy or missing" }
  if ($oldCodexChildren.Count -gt 0) {
    $reasons += "stale Codex child process(es): $($oldCodexChildren.ProcessId -join ', ')"
  }

  if ($reasons.Count -eq 0) {
    Write-WatchdogLog "Healthy. Daemon PID(s): $($daemonPids -join ', '); Codex child count: $($codexChildren.Count)."
    return
  }

  Write-WatchdogLog "Restart required: $($reasons -join '; ')."
  $roots = @($daemonPids + ($codexChildren | Select-Object -ExpandProperty ProcessId) | Select-Object -Unique)
  Stop-ProcessTree -RootPids $roots
  foreach ($pidValue in $roots) {
    try { Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 2
  Start-Bridge
}

Write-WatchdogLog "Watchdog starting. IntervalMinutes=$IntervalMinutes MaxTaskMinutes=$MaxTaskMinutes Once=$Once."

do {
  Invoke-WatchdogCheck
  if ($Once) { break }
  Start-Sleep -Seconds ([Math]::Max(60, $IntervalMinutes * 60))
} while ($true)
