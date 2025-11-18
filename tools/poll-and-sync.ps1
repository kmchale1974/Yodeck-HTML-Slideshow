# =========================
# Yodeck Poll & Sync -> Git (Admin only)
# - Every INTERVAL seconds:
#   - Mirrors NAS Admin folder into local images folder
#   - git add/commit/push if anything changed
# =========================

# --- CONFIG -------------------------------------------------------
$Name    = "Admin"
$Src     = "\\Vortv-nas\vor-tv_nas media\_Marketing\_Yodeck-HTML-Slideshow_Admin"
$Dst     = "D:\repos\Yodeck-HTML-Slideshow\_Yodeck-HTML-Slideshow_Admin\images"
$RepoRoot = "D:\repos\Yodeck-HTML-Slideshow"
$GitExe   = "git"
$ValidExt = ".png",".jpg",".jpeg",".webp",".gif"
$IntervalSeconds = 60  # how often to scan

# --- FUNCTIONS ----------------------------------------------------
function Commit-And-Push($reason) {
  Push-Location $RepoRoot
  try {
    & $GitExe add -A | Out-Null
    $status = & $GitExe status --porcelain
    if (-not [string]::IsNullOrWhiteSpace($status)) {
      $msg = "chore(poll:$reason): sync at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
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

function Sync-Admin {
  if (!(Test-Path $Src)) {
    Write-Warning "[$Name] Source missing: $Src"
    return $false
  }
  New-Item -ItemType Directory -Path $Dst -Force | Out-Null

  # Get source files
  $srcFiles = Get-ChildItem -LiteralPath $Src -File -ErrorAction SilentlyContinue |
              Where-Object { $ValidExt -contains $_.Extension.ToLower() }

  # Get dest files
  $dstFiles = Get-ChildItem -LiteralPath $Dst -File -ErrorAction SilentlyContinue

  $changed = $false

  # Index dest by name
  $dstByName = @{}
  foreach ($f in $dstFiles) { $dstByName[$f.Name] = $f }

  # Copy new/updated from NAS
  foreach ($sf in $srcFiles) {
    $df = $dstByName[$sf.Name]
    $needCopy = $false
    if (-not $df) {
      $needCopy = $true
      Write-Host "[$Name] New file: $($sf.Name)"
    } elseif ($sf.Length -ne $df.Length -or $sf.LastWriteTimeUtc -gt $df.LastWriteTimeUtc) {
      $needCopy = $true
      Write-Host "[$Name] Updated file: $($sf.Name)"
    }

    if ($needCopy) {
      $dstPath = Join-Path $Dst $sf.Name
      Copy-Item -LiteralPath $sf.FullName -Destination $dstPath -Force
      $changed = $true
    }
  }

  # Delete files that no longer exist on NAS
  $srcNames = $srcFiles.Name
  foreach ($df in $dstFiles) {
    if ($srcNames -notcontains $df.Name) {
      Write-Host "[$Name] Removed file: $($df.Name)"
      Remove-Item -LiteralPath $df.FullName -Force
      $changed = $true
    }
  }

  return $changed
}

Write-Host "Polling NAS -> repo for $Name every $IntervalSeconds seconds."
Write-Host "Source:      $Src"
Write-Host "Destination: $Dst"
Write-Host "Press Ctrl+C to stop."

while ($true) {
  try {
    $changed = Sync-Admin
    if ($changed) {
      Commit-And-Push "$Name poll"
    } else {
      Write-Host "[$Name] No file changes this cycle."
    }
  } catch {
    Write-Warning "[$Name] Poll cycle error: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds $IntervalSeconds
}
