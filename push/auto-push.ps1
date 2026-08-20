# auto-push.ps1
# Checks the Nexus repo for uncommitted changes. If any exist, commits them
# with a timestamped message and pushes to GitHub. If nothing changed, does
# nothing (no empty commits). Designed to be run on a timer via Windows Task
# Scheduler, not left running in an open window.
#
# Logs every run (success, no-op, or failure) to auto-push.log in the same
# folder, so failures are visible and never silently swallowed.

$repoPath = "C:\dev\nexus-app"
$logFile = Join-Path $repoPath "auto-push.log"

function Write-Log {
    param([string]$message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp  $message" | Out-File -FilePath $logFile -Append -Encoding utf8
}

Set-Location $repoPath

# Check if there's anything to commit at all - avoids empty commits.
$status = git status --porcelain
if (-not $status) {
    Write-Log "No changes - skipped."
    exit 0
}

Write-Log "Changes detected, committing..."

git add . 2>&1 | Out-Null

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
git commit -m "Auto-commit: $timestamp" 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: commit failed. Not attempting push."
    exit 1
}

git push origin main 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: push failed. Commit was saved locally but NOT sent to GitHub. Check manually."
    exit 1
}

Write-Log "Committed and pushed successfully."
