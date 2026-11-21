$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path "node_modules")) {
  Write-Host "[VibeEscrow] Dang cai dat node_modules lan dau..." -ForegroundColor Cyan
  npm install
}

$env:OFFLINE_MODE = "true"
$env:PORT = "3000"
$env:ARBITER_PASSWORD = "arbiter2026"

Write-Host "[VibeEscrow] Dang khoi dong che do Offline Demo Mode tai http://localhost:3000 ..." -ForegroundColor Green
Start-Job -ScriptBlock {
  Start-Sleep -Seconds 2
  Start-Process "http://localhost:3000"
} | Out-Null

node src/server.mjs
