@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0\.."

set "ALERTAS=0"
set "DETALHES="

echo === Health check ===
echo.

REM 1. Sessao WhatsApp (heuristica: ficheiros em session\ modificados ha menos de 30 dias)
for /f "delims=" %%A in ('powershell -NoProfile -Command "if (Test-Path 'session') { $f = Get-ChildItem -Path 'session' -Recurse -File -ErrorAction SilentlyContinue ^| Sort-Object LastWriteTime -Descending ^| Select-Object -First 1; if ($f -and ((Get-Date) - $f.LastWriteTime).TotalDays -lt 30) { 'ok' } else { 'stale' } } else { 'missing' }"') do set "SESSAO=%%A"
if /i "!SESSAO!"=="ok" (
    echo [ OK  ] sessao WhatsApp recente
) else (
    echo [AVISO] sessao WhatsApp: !SESSAO! ^(pode precisar re-autenticar^)
    set /a ALERTAS+=1
    set "DETALHES=!DETALHES! sessao;"
)

REM 2. Claude CLI
claude --version >nul 2>&1
if errorlevel 1 (
    echo [AVISO] claude CLI nao responde
    set /a ALERTAS+=1
    set "DETALHES=!DETALHES! claude;"
) else (
    echo [ OK  ] claude CLI
)

REM 3. Espaco em disco (>500MB)
for /f "delims=" %%A in ('powershell -NoProfile -Command "$d = (Get-Item '.').PSDrive; if ($d.Free -gt 500MB) { 'ok' } else { '{0:N0}MB' -f ($d.Free / 1MB) }"') do set "DISCO=%%A"
if /i "!DISCO!"=="ok" (
    echo [ OK  ] disco com espaco suficiente
) else (
    echo [AVISO] disco baixo: !DISCO! livres
    set /a ALERTAS+=1
    set "DETALHES=!DETALHES! disco;"
)

REM 4. Pipeline correu nos ultimos 7 dias
for /f "delims=" %%A in ('powershell -NoProfile -Command "if (Test-Path 'logs\start.log') { if (((Get-Date) - (Get-Item 'logs\start.log').LastWriteTime).TotalDays -lt 7) { 'ok' } else { 'stale' } } else { 'missing' }"') do set "PIPELINE=%%A"
if /i "!PIPELINE!"=="ok" (
    echo [ OK  ] pipeline correu nos ultimos 7 dias
) else (
    echo [AVISO] pipeline: !PIPELINE!
    set /a ALERTAS+=1
    set "DETALHES=!DETALHES! pipeline;"
)

echo.
if !ALERTAS!==0 (
    echo === Tudo saudavel. ===
    exit /b 0
)

echo === !ALERTAS! aviso^(s^):!DETALHES! ===
node "scripts\notify.js" "Health check" "!ALERTAS! aviso(s):!DETALHES!" >nul 2>&1
exit /b 1
