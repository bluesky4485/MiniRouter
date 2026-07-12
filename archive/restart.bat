REM DEPRECATED: Windows batch file for local development only.
REM MiniRouter production deployment uses Docker. See docker-compose.yml.
@echo off
REM Restart MiniRouter on port 8402
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8402 ^| findstr LISTENING') do (
  echo Killing MiniRouter PID %%a...
  taskkill /PID %%a /T /F >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo Starting MiniRouter on http://localhost:8402...
cd /d "%~dp0"
npx tsx src/server/serve.ts
