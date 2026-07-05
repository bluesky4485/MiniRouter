@echo off
cd /d "%~dp0"

set HEADROOM_PORT=8787
set "HEADROOM_EXE=%~dp0.external\headroom\.venv\Scripts\headroom.exe"
set "HEADROOM_LOG=%~dp0.external\headroom\proxy.log"

if not exist "%HEADROOM_EXE%" (
  echo Headroom is not installed: %HEADROOM_EXE%
  echo Install it in .external\headroom\.venv and run this script again.
  exit /b 1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%HEADROOM_PORT% ^| findstr LISTENING') do (
  echo Killing existing Headroom PID %%a...
  taskkill /PID %%a /T /F >nul 2>&1
)

timeout /t 1 /nobreak >nul

echo Starting Headroom on http://127.0.0.1:%HEADROOM_PORT% ...
echo Logs: .external\headroom\proxy.log
start "Headroom" "%HEADROOM_EXE%" proxy --port %HEADROOM_PORT% --mode cache --no-ccr-inject-tool --lossless --log-file "%HEADROOM_LOG%"

echo Headroom started. Close the Headroom window or run: npm run headroom:stop
exit /b 0
