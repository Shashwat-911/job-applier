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

echo  [1/3] Starting API server (port 3001)...
start "JobFlow API Server" /min cmd /c "node bot/server.js"

:: Wait for the server to bind before opening the browser
echo  [2/3] Waiting for server to start...
timeout /t 3 /nobreak >nul

echo  [3/3] Opening dashboard in browser...
start "" "http://localhost:5173"

echo.
echo  Starting dashboard dev server — close this window to stop everything.
echo  Dashboard : http://localhost:5173
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
