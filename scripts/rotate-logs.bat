@echo off
REM Wrapper para rotate-logs.ps1 — invocado pelo start.bat
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rotate-logs.ps1"
exit /b %errorlevel%
