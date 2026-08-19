# apply-updates.ps1
# Run this from inside a folder full of freshly-downloaded fix files (e.g.
# your Downloads folder, or a dedicated staging folder) to copy all of them
# into your live Nexus project in one step, instead of dragging files in
# one at a time.
#
# Usage:
#   1. Download whatever files were given to you into ONE folder together.
#   2. Put this script in that same folder.
#   3. Run it: .\apply-updates.ps1
#
# It copies every file in the current folder (except itself) into
# C:\dev\nexus-app, overwriting anything with the same name, then shows you
# a summary. It does NOT run git commit/push - your existing auto-push
# scheduled task (or manual git commands) handles that separately.

$targetPath = "C:\dev\nexus-app"
$scriptName = "apply-updates.ps1"

if (-not (Test-Path $targetPath)) {
    Write-Host "ERROR: $targetPath does not exist. Check the path is correct." -ForegroundColor Red
    exit 1
}

$filesToCopy = Get-ChildItem -Path . -File | Where-Object { $_.Name -ne $scriptName }

if ($filesToCopy.Count -eq 0) {
    Write-Host "No files found in this folder to copy (besides this script itself)."
    exit 0
}

Write-Host "Copying $($filesToCopy.Count) file(s) into $targetPath ..."
Write-Host ""

foreach ($file in $filesToCopy) {
    Copy-Item -Path $file.FullName -Destination (Join-Path $targetPath $file.Name) -Force
    Write-Host "  -> $($file.Name)"
}

Write-Host ""
Write-Host "Done. All files copied into $targetPath." -ForegroundColor Green
Write-Host "Restart Nexus (npm start) to see the changes take effect."
Write-Host "Your auto-push task will pick up and push these changes on its next run,"
Write-Host "or run 'git add . ; git commit -m \"applied updates\" ; git push' manually to push right away."
