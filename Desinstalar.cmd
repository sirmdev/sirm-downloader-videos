@echo off
setlocal
title SirM Downloader Videos
set "TV_PS=powershell.exe"
where pwsh.exe >nul 2>nul
if not errorlevel 1 set "TV_PS=pwsh.exe"
"%TV_PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
pause
