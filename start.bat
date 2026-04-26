@echo off
cd /d "%~dp0"

REM Kill any existing process holding port 3000 or 5173
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Stopping existing server on port 3000 ^(PID %%a^)...
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
    echo Stopping existing server on port 5173 ^(PID %%a^)...
    taskkill /F /PID %%a >nul 2>&1
)

echo Starting Media Downloader...
echo.

REM Start the Express API server in the background
start "" /b cmd /c "npm run server"

REM Start the Vite dev server (opens browser automatically)
npm run dev

echo.
echo Servers stopped.
pause
