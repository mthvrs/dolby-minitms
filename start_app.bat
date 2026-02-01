@echo off
setlocal
title Dolby Control Server (Win7)

cd /d "%~dp0"

REM ----------------------------------------------------------------
REM --- CLEANUP SECTION: Restart Logic -----------------------------
REM ----------------------------------------------------------------

echo [INFO] Checking for existing instances to clean up...

REM 1. Kill Node.js Server
taskkill /F /IM node.exe /T 2>nul

REM 2. Kill SPECIFIC Chrome App Window by Title
REM Uses PowerShell to find a window with "Contr*le Cin*ma" in the title.
REM We use wildcards (*) to ignore the accents (ô/é) which can cause bugs in batch files.
powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -like '*Contr*le Cin*ma*'} | Stop-Process -Force" 2>nul

REM 3. Short pause to ensure ports/processes are freed
timeout /t 2 /nobreak >nul

REM ----------------------------------------------------------------
REM --- STARTUP SECTION --------------------------------------------
REM ----------------------------------------------------------------

REM --- Check for Node.js ---
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js v13.14.0 [Last version for Windows 7].
    pause
    exit /b
)

REM --- Install Dependencies if needed ---
if not exist node_modules (
    echo [INFO] First run detected. Installing Windows 7 compatible dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Dependency installation failed.
        pause
        exit /b
    )
)

REM --- Start Server ---
echo [INFO] Starting Dolby Control Server...
start "DolbyControl Server" /min node server.js

REM --- Wait for server boot ---
timeout /t 3 /nobreak >nul

REM --- Launch Browser (Try System Chrome, then x86 Chrome, then Default Browser) ---
echo [INFO] Launching Interface...

REM Attempt 1: Standard Chrome Command (checks PATH)
start chrome --app=http://localhost:8347 --new-window --window-size=1280,800 2>nul
if %errorlevel% equ 0 goto end

REM Attempt 2: Common Win7 x86 Path
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --app=http://localhost:8347 --new-window --window-size=1280,800
    goto end
)

REM Attempt 3: Common Win7 x64 Path
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app=http://localhost:8347 --new-window --window-size=1280,800
    goto end
)

REM Fallback: System Default Browser
start http://localhost:8347

:end
exit