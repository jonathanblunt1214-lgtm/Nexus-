@echo off
setlocal enabledelayedexpansion

echo ===============================================
echo   NEXUS - Building Windows Installer (.exe)
echo ===============================================
echo.

where node >nul 2>nul
if not errorlevel 1 goto :haveNode

echo Node.js was not found. Attempting to install it automatically using
echo Windows' built-in App Installer (winget)...
echo.

where winget >nul 2>nul
if errorlevel 1 goto :noWinget

winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto :noWinget

for /f "skip=2 tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SysPath=%%B"
for /f "skip=2 tokens=2,*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "UserPath=%%B"
set "PATH=%SysPath%;%UserPath%;%PATH%"

where node >nul 2>nul
if not errorlevel 1 goto :haveNode

echo.
echo Node was installed but this window still can't see it. Please close
echo this window, restart your computer once, then double-click this file
echo again -- it will skip straight past this step next time.
pause
exit /b 1

:noWinget
echo.
echo Could not install Node.js automatically. Please install it yourself:
echo   1. Go to https://nodejs.org
echo   2. Download and run the LTS installer (leave all options default)
echo   3. Restart your computer
echo   4. Double-click this file again
pause
exit /b 1

:haveNode
echo Node.js is ready.
echo.

if not exist "node_modules" (
  echo Installing dependencies first, this can take a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo Something went wrong during install. Scroll up to see the error.
    pause
    exit /b 1
  )
)

echo.
echo Building installer...
call npm run dist
if errorlevel 1 (
  echo.
  echo Something went wrong during the build. Scroll up to see the error.
  pause
  exit /b 1
)

echo.
echo Done. Your installer is in the "dist" folder (look for a file
echo ending in "Setup.exe"). Double-click it to install Nexus like any
echo normal Windows program, with a real Start Menu / Desktop shortcut.
echo.
start "" "dist"

endlocal
