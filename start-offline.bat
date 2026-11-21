@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo [VibeEscrow] Dang cai dat node_modules lan dau...
  call npm install
)

set "OFFLINE_MODE=true"
set "PORT=3000"
set "ARBITER_PASSWORD=arbiter2026"

echo [VibeEscrow] Dang khoi dong che do Offline Demo Mode tai http://localhost:3000 ...
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"
node src/server.mjs
pause
