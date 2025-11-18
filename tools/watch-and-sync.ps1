# =========================
# Yodeck Watch & Sync -> Git (Simplified)
# - Watches NAS Admin/RAEC/Rec folders
# - Copies images into repo subfolders
# - Immediately git add/commit/push after each change
# =========================

# --- CONFIG -------------------------------------------------------
$Pairs = @(
  @{ Name="Admin"; Src="\\Vortv-nas\vor-tv_nas media\_Marketing\_Yodeck-HTML-Slideshow_Admin"; Dst="D:\repos\Yodeck-HTML-Slideshow\_Yodeck-HTML-Slideshow_Admin\images" },
  @{ Name="RAEC";  Src="\\Vortv-nas\vor-tv_nas media\_Marketing\_Yodeck-HTML-Slideshow_RAEC";  Dst="D:\repos\Yodeck-HTML-Slideshow\_Yodeck-HTML-Slideshow_RAEC\images" },
  @{ Name="Rec";   Src="\\Vortv-nas\vor-tv_nas media\_Marketing\_Yodeck-HTML-Slideshow_Rec";   Dst="D:\repos\Yodeck-HTML-Slideshow\_Yodeck-HTML-Slideshow_Rec\images" }
)
# update RAEC/Rec Src if needed

$RepoRoot = "D:\repos\Yodeck-HTML-Slideshow"
$GitExe   = "git"
$ValidExt = ".png",".jpg",".jpeg",".webp",".gif"

# --- FUNCTIONS ----------------------------------------------------
function Copy-IfComplete($src, $dstDir) {
  try {
    if (!(Test-Path $src)) { return $false }
    Start-Sleep -Milliseconds 800
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

function Commit-And-Push($reason) {
  Push-Location $RepoRoot
  try {
    & $GitExe add -A | Out-Null
    $status = & $GitExe status --porcelain
    if (-not [string]::IsNullOrWhiteSpace($status)) {
      $msg = "chore(watch:$reason): sync at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
      Write-Host "---- git status ----"
      $status | Write-Host
      Write-Host "Committing & pushing: $msg"
      & $GitExe commit -m $msg | Out-Null
      & $GitExe push | Out-Null
      Write-Host "Pushed changes OK."
    } else {
      Write-Host "No changes to commit for $reason"
    }
  } catch {
    Write-Warning "Commit/Push failed for $reason : $($_.Exception.Message)"
  } finally {
    Pop-Location
  }
}

function Sync-Once($name, $srcDir, $dstDir) {
  if (!(Test-Path $srcDir)) {
    Write-Warning "[$name] StartupSync: source missing: $srcDir"
    return
  }
  try {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    Get-ChildItem -LiteralPath $srcDir -File | ForEach-Object {
      if ($ValidExt -contains $_.Extension.ToLower()) {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dstDir $_.Name) -Force
      }
    }
    Write-Host "[$name] StartupSync: copied existing files from '$srcDir' to '$dstDir'"
    Commit-And-Push "$name StartupSync"
  } catch {
    Write-Warning "[$name] StartupSync failed: $($_.Exception.Message)"
  }
}

# --- WATCHERS -----------------------------------------------------
$watchers = @()

foreach ($p in $Pairs) {
  $name = $p.Name
  $src  = $p.Src
  $dst  = $p.Dst

  New-Item -ItemType Directory -Path $dst -Force | Out-Null

  if (-not (Test-Path $src)) {
    Write-Warning "[$name] Source missing: $src . Watcher skipped."
    continue
  }

  try {
    $w = New-Object IO.FileSystemWatcher $src, "*.*"
  } catch {
    Write-Warning "[$name] Could not start watcher: $($_.Exception.Message)"
    continue
  }

  $w.IncludeSubdirectories = $false
  $w.EnableRaisingEvents   = $true

  # Created
  Register-ObjectEvent $w Created -SourceIdentifier "created_$name" -Action {
    if (Copy-IfComplete $Event.SourceEventArgs.FullPath $using:dst) {
      Write-Host "[$($using:name)] Created: $($Event.SourceEventArgs.Name)"
      Commit-And-Push "$($using:name) Created"
    }
  } | Out-Null

  # Changed
  Register-ObjectEvent $w Changed -SourceIdentifier "changed_$name" -Action {
    if (Copy-IfComplete $Event.SourceEventArgs.FullPath $using:dst) {
      Write-Host "[$($using:name)] Changed: $($Event.SourceEventArgs.Name)"
      Commit-And-Push "$($using:name) Changed"
    }
  } | Out-Null

  # Renamed
  Register-ObjectEvent $w Renamed -SourceIdentifier "renamed_$name" -Action {
    if (Copy-IfComplete $Event.SourceEventArgs.FullPath $using:dst) {
      Write-Host "[$($using:name)] Renamed: $($Event.SourceEventArgs.Name)"
      Commit-And-Push "$($using:name) Renamed"
    }
    $old = $Event.SourceEventArgs.OldName
    if ($old) {
      if (Remove-IfExists $using:dst $old) {
        Write-Host "[$($using:name)] Removed old name: $old"
        Commit-And-Push "$($using:name) RemovedOldName"
      }
    }
  } | Out-Null

  # Deleted
  Register-ObjectEvent $w Deleted -SourceIdentifier "deleted_$name" -Action {
    if (Remove-IfExists $using:dst $Event.SourceEventArgs.Name) {
      Write-Host "[$($using:name)] Deleted: $($Event.SourceEventArgs.Name)"
      Commit-And-Push "$($using:name) Deleted"
    }
  } | Out-Null

  $watchers += $w
  Write-Host "Watching $src  →  $dst"

  # One-time startup sync for this section
  Sync-Once $name $src $dst
}

if ($watchers.Count -eq 0) {
  Write-Warning "No watchers started. Verify NAS paths."
} else {
  Write-Host "Watchers running. Press Ctrl+C to stop."
}

while ($true) { Start-Sleep -Seconds 1 }
