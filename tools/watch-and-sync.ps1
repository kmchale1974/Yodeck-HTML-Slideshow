# --- CONFIG -------------------------------------------------------
$Pairs = @(
    @{ Name="Admin"; Src="\\Server\Share\_Yodeck-HTML-Slideshow_Admin"; Dst="D:\repos\Yodeck-HTML-Slideshow\_Yodeck-HTML-Slideshow_Admin\images" },
    @{ Name="RAEC";  Src="\\Server\Share\_Yodeck-HTML-Slideshow_RAEC";  Dst="D:\repos\Yodeck-HTML-Slideshow\_Yodeck-HTML-Slideshow_RAEC\images" },
    @{ Name="Rec";   Src="\\Server\Share\_Yodeck-HTML-Slideshow_Rec";   Dst="D:\repos\Yodeck-HTML-Slideshow\_Yodeck-HTML-Slideshow_Rec\images" }
)

$RepoRoot = "D:\repos\Yodeck-HTML-Slideshow"
$GitExe   = "git"  # assumes git is in PATH
$ValidExt = ".png",".jpg",".jpeg",".webp",".gif"
$CommitMessagePrefix = "chore(watch): sync"
$DebounceMs = 1500  # wait a bit so files finish copying
$Queue = New-Object System.Collections.Concurrent.ConcurrentQueue[object]
$Timer = New-Object System.Timers.Timer
$Timer.Interval = 3000
$Timer.AutoReset = $true
$Timer.Enabled = $true

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
    } catch { return $false }
}

function Remove-IfExists($dstDir, $name) {
    try {
        $path = Join-Path $dstDir $name
        if (Test-Path $path) { Remove-Item -LiteralPath $path -Force }
        return $true
    } catch { return $false }
}

function Enqueue-Change($section, $action, $name) {
    $Queue.Enqueue([PSCustomObject]@{Section=$section; Action=$action; Name=$name; Ts=(Get-Date)})
}

function Flush-Queue-And-Commit {
    # drain queue
    while ($Queue.TryDequeue([ref]$null)) { }

    Push-Location $RepoRoot
    try {
        & $GitExe add -A | Out-Null
        $status = & $GitExe status --porcelain
        if (-not [string]::IsNullOrWhiteSpace($status)) {
            $msg = "$CommitMessagePrefix at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
            & $GitExe commit -m $msg | Out-Null
            & $GitExe push | Out-Null
            Write-Host "Pushed changes: $msg"
        }
    } finally {
        Pop-Location
    }
}

# Timer tick: if there are pending changes, commit them
$Timer.Add_Elapsed({
    if (-not $Queue.IsEmpty) {
        Flush-Queue-And-Commit
    }
})

# --- WATCHERS -----------------------------------------------------
$watchers = @()
foreach ($p in $Pairs) {
    $src = $p.Src
    $dst = $p.Dst
    New-Item -ItemType Directory -Path $dst -Force | Out-Null

    $w = New-Object IO.FileSystemWatcher $src, "*.*"
    $w.IncludeSubdirectories = $false
    $w.EnableRaisingEvents = $true

    Register-ObjectEvent $w Created -SourceIdentifier "created_$($p.Name)" -Action {
        if (Copy-IfComplete $Event.SourceEventArgs.FullPath $using:dst) {
            Enqueue-Change $using:p.Name "Created" $Event.SourceEventArgs.Name
        }
    } | Out-Null

    Register-ObjectEvent $w Changed -SourceIdentifier "changed_$($p.Name)" -Action {
        if (Copy-IfComplete $Event.SourceEventArgs.FullPath $using:dst) {
            Enqueue-Change $using:p.Name "Changed" $Event.SourceEventArgs.Name
        }
    } | Out-Null

    Register-ObjectEvent $w Renamed -SourceIdentifier "renamed_$($p.Name)" -Action {
        if (Copy-IfComplete $Event.SourceEventArgs.FullPath $using:dst) {
            Enqueue-Change $using:p.Name "Renamed" $Event.SourceEventArgs.Name
        }
        $old = $Event.SourceEventArgs.OldName
        if ($old) { Remove-IfExists $using:dst $old | Out-Null }
    } | Out-Null

    Register-ObjectEvent $w Deleted -SourceIdentifier "deleted_$($p.Name)" -Action {
        if (Remove-IfExists $using:dst $Event.SourceEventArgs.Name) {
            Enqueue-Change $using:p.Name "Deleted" $Event.SourceEventArgs.Name
        }
    } | Out-Null

    $watchers += $w
    Write-Host "Watching $src  →  $dst"
}

Write-Host "Watchers running. Press Ctrl+C to stop."
while ($true) { Start-Sleep -Seconds 1 }
