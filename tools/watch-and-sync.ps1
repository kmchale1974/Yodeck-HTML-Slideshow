# =========================
# Yodeck Watch & Sync -> Git
# - Watches NAS folders for Admin/RAEC/Rec
# - Copies images into repo subfolders
# - Batches and git add/commit/push
# - Does a Startup Sync so existing files are included immediately
# =========================

# --- CONFIG -------------------------------------------------------
$Pairs = @(
  @{ Name="Admin"; Src="\\Vortv-nas\vor-tv_nas media\_Marketing\_Yodeck-HTML-Slideshow_Admin"; Dst="D:\repos\Yodeck-HTML-Slideshow\_Yodeck-HTML-Slideshow_Admin\images" },
  @{ Name="RAEC";  Src="\\Vortv-nas\vor-tv_nas media\_Marketing\_Yodeck-HTML-Slideshow_RAEC";  Dst="D:\repos\Yodeck-HTML-Slideshow\_Yodeck-HTML-Slideshow_RAEC\images" },
  @{ Name="Rec";   Src="\\Vortv-nas\vor-tv_nas media\_Marketing\_Yodeck-HTML-Slideshow_Rec";   Dst="D:\repos\Yodeck-HTML-Slideshow\_Yodeck-HTML-Slideshow_Rec\images" }
)
# If your RAEC/Rec NAS paths differ, update the Src values above.

$RepoRoot = "D:\repos\Yodeck-HTML-Slideshow"
$GitExe   = "git"   # assumes Git is in PATH
$ValidExt = ".png",".jpg",".jpeg",".webp",".gif"
$CommitMessagePrefix = "chore(watch): sync"
$DebounceMs = 1500   # wait a bit so files finish copying

# --- Batching -----------------------------------------------------
$Queue  = New-Object System.Collections.Concurrent.ConcurrentQueue[object]
$Timer  = New-Object System.Timers.Timer
$Timer.Interval = 3000
$Timer.AutoReset = $true
$Timer.Enabled   = $true

# --- FUNCTIONS ----------------------------------------------------
function Copy-IfComplete($src, $dstDir) {
  try {
    if (!(Test-Path $src)) { return $false }
    Start-Sleep -Milliseconds $DebounceMs
    $fi = Get-Item -LiteralPath $src -ErrorAction Stop
    if ($ValidExt -notcontains $fi.Extension.ToLower()) { return $false }

    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    $dst = Join-Path $dstDir $fi.Name
    Copy-Item -LiteralPath $src -Destination $dst -Force
    return $true
  } catch {
    Write-Warning "Copy failed for '$src' -> '$dstDir' : $($_.Exception.Message)"
    return $false
  }
}

function Remove-IfExists($dstDir, $name) {
  try {
    $path = Join-Path $dstDir $name
    if (Test-Path $path) { Remove-Item -LiteralPath $path -Force }
    return $true
  } catch {
    Write-Warning "Remove failed for '$name' in '$dstDir' : $($_.Exception.Message)"
    return $false
  }
}

function Enqueue-Change($section, $action, $name) {
  $Queue.Enqueue([PSCustomObject]@{Section=$section; Action=$action; Name=$name; Ts=(Get-Date)})
}

function Flush-Queue-And-Commit {
  # drain queue (we just commit everything changed in the working copy)
  while ($Queue.TryDequeue([ref]$null)) { }

  Push-Location $RepoRoot
  try {
    & $GitExe add -A | Out-Null
    $status = & $GitExe status --porcelain
    if (-not [string]::IsNullOrWhiteSpace($status)) {
      $msg = "$CommitMessagePrefix at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
      Write-Host "---- git status ----"
      $status | Write-Host
      Write-Host "--------------------"
      & $GitExe commit -m $msg | Out-Null
      & $GitExe push | Out-Null
      Write-Host "Pushed changes: $msg"
    }
  } finally {
    Pop-Location
  }
}

# Startup sync: copy everything currently in $src into $dst once
function Sync-Once($srcDir, $dstDir) {
  if (!(Test-Path $srcDir)) { return }
  try {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    Get-ChildItem -LiteralPath $srcDir -File | ForEach-Object {
      if ($ValidExt -contains $_.Extension.ToLower()) {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dstDir $_.Name) -Force
      }
    }
    Write-Host "[StartupSync] Copied existing files from '$srcDir' to '$dstDir'"
  } catch {
    Write-Warning "[StartupSync] Failed for '$srcDir' -> '$dstDir' : $($_.Exception.Message)"
  }
}

# Timer tick: if there are pending changes, commit them
$Timer.Add_Elapsed({
  if (-not $Queue.IsEmpty) {
    Flush-Queue-And-Commit
  }
})

# --- WATCHERS (with existence checks + startup sync) --------------
$watchers = @()
foreach ($p in $Pairs) {
  $src = $p.Src; $dst = $p.Dst
  New-Item -ItemType Directory -Path $dst -Force | Out-Null

  if (-not (Test-Path $src)) {
    Write-Warning "Source missing: $src . This watcher will be skipped until the folder exists."
    continue
  }

  try {
    $w = New-Object IO.FileSystemWatcher $src, "*.*"
  } catch {
    Write-Warning "Could not start watcher for $src : $($_.Exception.Message)"
    continue
  }

  $w.IncludeSubdirectories = $false
  $w.EnableRaisingEvents   = $true

  # Created
  Register-ObjectEvent $w Created -SourceIdentifier "created_$($p.Name)" -Action {
    if (Copy-IfComplete $Event.SourceEventArgs.FullPath $using:dst) {
      Enqueue-Change $using:p.Name "Created" $Event.SourceEventArgs.Name
      Write-Host "[$($using:p.Name)] Created: $($Event.SourceEventArgs.Name)"
    }
  } | Out-Null

  # Changed
  Register-ObjectEvent $w Changed -SourceIdentifier "changed_$($p.Name)" -Action {
    if (Copy-IfComplete $Event.SourceEventArgs.FullPath $using:dst) {
      Enqueue-Change $using:p.Name "Changed" $Event.SourceEventArgs.Name
      Write-Host "[$($using:p.Name)] Changed: $($Event.SourceEventArgs.Name)"
    }
  } | Out-Null

  # Renamed
  Register-ObjectEvent $w Renamed -SourceIdentifier "renamed_$($p.Name)" -Action {
    if (Copy-IfComplete $Event.SourceEventArgs.FullPath $using:dst) {
      Enqueue-Change $using:p.Name "Renamed" $Event.SourceEventArgs.Name
      Write-Host "[$($using:p.Name)] Renamed: $($Event.SourceEventArgs.Name)"
    }
    $old = $Event.SourceEventArgs.OldName
    if ($old) {
      if (Remove-IfExists $using:dst $old) {
        Enqueue-Change $using:p.Name "RemovedOldName" $old
        Write-Host "[$($using:p.Name)] Removed old name: $old"
      }
    }
  } | Out-Null

  # Deleted
  Register-ObjectEvent $w Deleted -SourceIdentifier "deleted_$($p.Name)" -Action {
    if (Remove-IfExists $using:dst $Event.SourceEventArgs.Name) {
      Enqueue-Change $using:p.Name "Deleted" $Event.SourceEventArgs.Name
      Write-Host "[$($using:p.Name)] Deleted: $($Event.SourceEventArgs.Name)"
    }
  } | Out-Null

  $watchers += $w
  Write-Host "Watching $src  →  $dst"

  # === 3C: STARTUP SYNC + enqueue a commit ===
  Sync-Once $src $dst
  Enqueue-Change $p.Name "StartupSync" "*"
}

if ($watchers.Count -eq 0) {
  Write-Warning "No watchers started. Verify your UNC paths or map a drive (New-PSDrive) and update Src paths."
}

Write-Host "Watchers running. Press Ctrl+C to stop."
while ($true) { Start-Sleep -Seconds 1 }
