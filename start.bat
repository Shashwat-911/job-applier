@echo off
title JobFlow — Launching...
cls

echo.
echo  =====================================
echo    JobFlow - Job Application Suite
echo  =====================================
echo.

:: Check Node is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found. Install it from https://nodejs.org
    pause
    exit /b 1
)

:: Move to the script's own directory so paths are always correct
cd /d "%~dp0"

:: ── Step 1: Automated Session Harvesting ─────────────────────────────────
echo  [1/4] Checking browser session status...
tasklist | findstr /i /c:"brave.exe" >nul
if %errorlevel% neq 0 goto :do_harvest

echo.
echo  [!] Brave browser is currently open.
echo      Session harvesting requires closing Brave so your session data can be read.
echo.
set "CLOSE_BRAVE="
set /p "CLOSE_BRAVE=Close Brave now to harvest latest sessions? [Y/n]: "
if /i "%CLOSE_BRAVE%"=="n" (
    echo.
    echo  Skipping session harvest... Proceeding with existing session cookies.
    goto :after_harvest
)
echo.
echo  Closing Brave browser...
taskkill /IM brave.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

:do_harvest
echo.
echo  Harvesting platform sessions from Brave profile...
node bot/harvestSessions.js

:after_harvest
echo.

:: ── Step 2: Start API Server ─────────────────────────────────────────────
echo  [2/4] Starting API server (port 3001)...
start "JobFlow API Server" /min cmd /c "node bot/server.js"

:: ── Step 3: Wait and Open Dashboard ──────────────────────────────────────
echo  [3/4] Waiting for server to start...
timeout /t 3 /nobreak >nul

echo  [4/4] Opening dashboard in browser...
start "" "http://localhost:5173/run"

echo.
echo  Starting dashboard dev server — close this window to stop everything.
echo  Dashboard : http://localhost:5173/run
echo  API       : http://localhost:3001
echo.

:: Run Vite in the foreground so the window stays open
:: Closing this window will also kill the backgrounded server window
cd dashboard
npx vite --port 5173

:: If Vite exits, pause so the user can read any error
echo.
echo  Dashboard stopped. Press any key to close.
pause >nul
