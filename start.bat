@echo off
cd /d "%~dp0"

REM Open the browser ~6s after the dev server kicks off so Nuxt has a
REM head start on its cold compile. Backgrounded so the foreground npm
REM run dev below can boot in parallel.
start "" /B cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:3000/"

REM Dev server in the foreground. Closing this window stops it.
call npm run dev

echo.
echo Server stopped.
pause
