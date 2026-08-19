# setup-auto-push-task.ps1
# Run this ONCE to register a Windows Scheduled Task that runs auto-push.ps1
# every 30 minutes, indefinitely, without needing a terminal window open.

$scriptPath = "C:\dev\nexus-app\auto-push.ps1"
$taskName = "Nexus Auto-Push"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 30)

# Task Scheduler rejects [TimeSpan]::MaxValue as a duration - this is the
# standard workaround: an empty string on the Repetition.Duration property
# means "repeat indefinitely, no end date."
$trigger.Repetition.Duration = ""

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Auto-commits and pushes Nexus changes to GitHub every 30 minutes."

Write-Host ""
Write-Host "Done. Task '$taskName' is now registered and will run every 30 minutes."
Write-Host "To check on it: open Task Scheduler (search Start menu) and look under Task Scheduler Library."
Write-Host "Logs will appear in C:\dev\nexus-app\auto-push.log as it runs."
