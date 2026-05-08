@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ========================================================================
REM  Fase 5: orquestrador silencioso (Task Scheduler / start_silent.vbs)
REM  Pipeline: scraper -> analyzer -> UI
REM  Exit codes:
REM    0  = ok
REM    10 = lock activo (outra execucao em curso)
REM    20 = sem ligacao a internet apos 120s
REM    30 = scraper falhou
REM    31 = sessao WhatsApp expirou (subset de 30)
REM    40 = analyzer falhou
REM    50 = UI falhou
REM ========================================================================

cd /d "%~dp0"

if not exist "logs" mkdir "logs"
if not exist "data" mkdir "data"

set "LOG=logs\start.log"
set "LOCK=data\.lock"
set "MOTIVO="
set "EXITCODE=0"

REM 0. Rotacao de logs (best-effort)
call "scripts\rotate-logs.bat" >nul 2>&1

REM 1. Verificar lock
call :verificarLock
if errorlevel 1 (
    echo [%date% %time%] ABORT: lock activo, outra execucao em curso. >> "%LOG%"
    exit /b 10
)

REM 2. Criar lock
call :criarLock

REM 3. Esperar conectividade (max 120s)
call :esperarRede
if errorlevel 1 (
    set "MOTIVO=sem ligacao a internet apos 120s"
    set "EXITCODE=20"
    goto :erro
)

echo [%date% %time%] INICIO pipeline silenciosa >> "%LOG%"

REM 4. Scraper
echo [%date% %time%] [1/3] scraper a correr >> "%LOG%"
node "scraper\scrape.js" >> "logs\scraper.log" 2>&1
set "RC=!errorlevel!"
if !RC! neq 0 (
    if !RC!==2 (
        set "MOTIVO=sessao WhatsApp expirou"
        set "EXITCODE=31"
        node "scripts\notify.js" --session-expired >nul 2>&1
        goto :erroSemNotify
    )
    set "MOTIVO=scraper falhou ^(exit !RC!^)"
    set "EXITCODE=30"
    goto :erro
)

REM 5. Validar output do scraper
if not exist "data\conversas.txt" (
    set "MOTIVO=scraper nao gerou data\conversas.txt"
    set "EXITCODE=30"
    goto :erro
)
for %%A in ("data\conversas.txt") do (
    if %%~zA==0 (
        set "MOTIVO=data\conversas.txt vazio"
        set "EXITCODE=30"
        goto :erro
    )
)

REM 6. Analyzer
echo [%date% %time%] [2/3] analyzer a correr >> "%LOG%"
call "analyzer\analyzer.bat" >> "logs\analyzer.log" 2>&1
set "RC=!errorlevel!"
if !RC! neq 0 (
    if !RC!==1 set "MOTIVO=analyzer: input em falta ou vazio"
    if !RC!==2 set "MOTIVO=analyzer: Claude Code falhou"
    if !RC!==3 set "MOTIVO=analyzer: todo.json invalido"
    if not defined MOTIVO set "MOTIVO=analyzer falhou ^(exit !RC!^)"
    set "EXITCODE=40"
    goto :erro
)

REM 7. Lancar UI
echo [%date% %time%] [3/3] UI a arrancar >> "%LOG%"
call :lancarUI
if errorlevel 1 (
    set "MOTIVO=falha a lancar UI"
    set "EXITCODE=50"
    goto :erro
)

REM 8. Sucesso
node "scripts\notify.js" --success >nul 2>&1

echo [%date% %time%] FIM ok >> "%LOG%"
call :limparLock
exit /b 0

REM ========================================================================
REM  Subroutinas
REM ========================================================================

:verificarLock
if not exist "%LOCK%" exit /b 0
for /f "delims=" %%A in ('powershell -NoProfile -Command "if ((Test-Path '%LOCK%') -and (((Get-Date) - (Get-Item '%LOCK%').LastWriteTime).TotalMinutes -lt 10)) { 'fresh' } else { 'stale' }"') do set "LOCKSTATE=%%A"
if /i "!LOCKSTATE!"=="fresh" exit /b 1
del /q "%LOCK%" >nul 2>&1
exit /b 0

:criarLock
powershell -NoProfile -Command "Get-Date -Format o | Out-File -Encoding ascii -FilePath '%LOCK%'" >nul 2>&1
exit /b 0

:limparLock
if exist "%LOCK%" del /q "%LOCK%" >nul 2>&1
exit /b 0

:esperarRede
set /a tentativas=0
:pingLoop
ping -n 1 -w 1000 8.8.8.8 >nul 2>&1
if not errorlevel 1 exit /b 0
set /a tentativas+=1
if !tentativas! geq 60 exit /b 1
timeout /t 2 /nobreak >nul 2>&1
goto :pingLoop

:lancarUI
netstat -ano | findstr ":8080" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [%date% %time%] UI ja activa no porto 8080 >> "%LOG%"
) else (
    start "" /B node "ui\server.js" >> "logs\server-stdout.log" 2>> "logs\server-stderr.log"
    timeout /t 3 /nobreak >nul 2>&1
)
start "" "http://127.0.0.1:8080"
exit /b 0

:erro
node "scripts\notify.js" --error "!MOTIVO!" >nul 2>&1
:erroSemNotify
echo [%date% %time%] ERRO: !MOTIVO! ^(exit !EXITCODE!^) >> "%LOG%"
call :limparLock
exit /b !EXITCODE!
