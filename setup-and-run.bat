@echo off
setlocal

echo ===============================================
echo   NEXUS - Automated Setup
echo ===============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on this computer.
  echo Please install it from https://nodejs.org (choose the LTS version),
  echo then double-click this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First-time setup: installing dependencies, this can take a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo Something went wrong during install. Scroll up to see the error.
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
