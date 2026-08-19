@echo off
setlocal enabledelayedexpansion

echo ===============================================
echo   NEXUS - One-Click Setup
echo ===============================================
echo.

REM --- Step 1: Do we already have Node? ---
where node >nul 2>nul
if not errorlevel 1 goto :haveNode

echo Node.js was not found. Attempting to install it automatically using
echo Windows' built-in App Installer (winget)...
echo.

where winget >nul 2>nul
if errorlevel 1 goto :noWinget

winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo.
  echo Automatic install via winget did not succeed. Falling back to manual steps below.
  goto :noWinget
)

echo.
echo Node.js installer finished. Refreshing this window's PATH so we don't
echo need a restart...

REM --- Pull the freshly-updated PATH from the registry into THIS session ---
for /f "skip=2 tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SysPath=%%B"
for /f "skip=2 tokens=2,*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "UserPath=%%B"
set "PATH=%SysPath%;%UserPath%;%PATH%"

where node >nul 2>nul
if not errorlevel 1 goto :haveNode

echo.
echo Node was installed but this window still can't see it. This can happen
echo on some systems. Please close this window, restart your computer once,
echo then double-click this file again — it will skip straight past this
echo step next time.
pause
exit /b 1

:noWinget
echo.
echo Could not install Node.js automatically on this computer.
echo Please install it yourself the normal way:
echo   1. Go to https://nodejs.org
echo   2. Download and run the LTS installer ^(leave all options default^)
echo   3. Restart your computer
echo   4. Double-click this file again
pause
exit /b 1

:haveNode
echo Node.js is ready.
echo.

REM --- Step 2: install Nexus's own dependencies, first run only ---
if not exist "node_modules" (
  echo Installing Nexus's dependencies ^(first run only, can take a minute^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo Something went wrong during install. Scroll up to see the error,
    echo or send it back to Claude for help.
    pause
    exit /b 1
  )
) else (
  echo Dependencies already installed, skipping that step.
)

echo.
echo Launching Nexus...
call npm start

endlocal
