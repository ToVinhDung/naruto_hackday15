@echo off
chcp 65001 >nul
title Smart Escrow AI Platform - PowerBatch Quick Start
cls
echo ======================================================================
echo    SMART ESCROW WITH MULTI-TIER AI AGENTS - POWERBATCH QUICK START
echo ======================================================================
echo.
echo [1/3] Kiem tra moi truong Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [LOI] Khong tim thay Node.js tren may tinh!
    echo Vui long cai dat Node.js tu https://nodejs.org/ truoc khi chay.
    pause
    exit /b 1
)
node -v
echo [OK] Node.js da san sang.
echo.
echo [2/3] Tu dong mo trinh duyet den: http://localhost:3000 ...
start http://localhost:3000
echo.
echo [3/3] Dang khoi dong Web Server va REST API Endpoints...
echo ======================================================================
echo   - Local Web UI : http://localhost:3000
echo   - Local IP     : http://127.0.0.1:3000
echo   - API Health   : http://localhost:3000/api/health
echo   - Agents Matrix: http://localhost:3000/api/agents/matrix
echo.
echo   * Nhan Ctrl + C de dung may chu.
echo ======================================================================
echo.
node "%~dp0src\server.mjs"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo May chu da dung hoac gap loi.
    pause
)

