@echo off
setlocal
title SirM Downloader Videos
set "TV_PS=powershell.exe"
where pwsh.exe >nul 2>nul
if not errorlevel 1 set "TV_PS=pwsh.exe"
"%TV_PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Instalacao do SirM Downloader Videos falhou. Leia a mensagem acima.
  pause
  exit /b 1
)
echo.
pause
