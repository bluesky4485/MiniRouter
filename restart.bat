@echo off
REM Restart MiniRouter on port 8402
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8402 ^| findstr LISTENING') do (
  echo Killing PID %%a...
  taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo Starting MiniRouter...
cd /d "%~dp0"
npx tsx src/server/serve.ts