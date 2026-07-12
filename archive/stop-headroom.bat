REM DEPRECATED: Windows batch file for local development only.
REM MiniRouter production deployment uses Docker. See docker-compose.yml.
@echo off
REM Stop Headroom proxy on port 8787
set HEADROOM_PORT=8787
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%HEADROOM_PORT% ^| findstr LISTENING') do (
  echo Stopping Headroom PID %%a...
  taskkill /PID %%a /F >nul 2>&1
)
echo Headroom stopped.
