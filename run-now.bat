@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ========================================================================
REM  Fase 5: orquestrador manual (consola visivel, output progressivo)
REM  Tambem invocado pelo endpoint POST /api/refresh com --no-pause
REM  Partilha o mesmo lock file que start.bat
REM ========================================================================

cd /d "%~dp0"

set "LOG=logs\start.log"
set "LOCK=data\.lock"
set "MOTIVO="
set "EXITCODE=0"
set "NOPAUSE="
if /i "%~1"=="--no-pause" set "NOPAUSE=1"

if not exist "logs" mkdir "logs"
if not exist "data" mkdir "data"

REM Verificar lock
call :verificarLock
if errorlevel 1 (
    echo.
    echo ^>^> ERRO: pipeline ja em execucao ^(lock fresco em %LOCK%^).
    echo ^>^> Aguarda ou apaga o lock manualmente se a execucao anterior crashou.
    if not defined NOPAUSE pause
    exit /b 10
)

call :criarLock

echo.
echo ============================================
echo  WhatsApp Task Extractor — execucao manual
echo ============================================
echo.

REM Wait curto de rede (5s)
echo ^>^> A verificar ligacao...
ping -n 1 -w 2000 8.8.8.8 >nul 2>&1
if errorlevel 1 (
    echo ^>^> AVISO: 8.8.8.8 nao respondeu — tentar continuar mesmo assim.
)

echo [%date% %time%] INICIO run-now >> "%LOG%"

echo.
echo ^>^> [1/3] A extrair conversas do WhatsApp...
echo.
node "scraper\scrape.js"
set "RC=!errorlevel!"
if !RC! neq 0 (
    if !RC!==2 (
        set "MOTIVO=sessao WhatsApp expirou — corre `npm run auth` em scraper/"
        set "EXITCODE=31"
    ) else (
        set "MOTIVO=scraper falhou ^(exit !RC!^)"
        set "EXITCODE=30"
    )
    goto :erro
)

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

echo.
echo ^>^> [2/3] A analisar conversas com Claude...
echo.
call "analyzer\analyzer.bat"
set "RC=!errorlevel!"
if !RC! neq 0 (
    if !RC!==1 set "MOTIVO=analyzer: input em falta ou vazio"
    if !RC!==2 set "MOTIVO=analyzer: Claude Code falhou"
    if !RC!==3 set "MOTIVO=analyzer: todo.json invalido"
    if not defined MOTIVO set "MOTIVO=analyzer falhou ^(exit !RC!^)"
    set "EXITCODE=40"
    goto :erro
)

echo.
echo ^>^> [3/3] A actualizar UI...
netstat -ano | findstr ":8080" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo ^>^> UI nao estava activa, a arrancar servidor em background...
    start "" /B node "ui\server.js" >> "logs\server-stdout.log" 2>> "logs\server-stderr.log"
    timeout /t 2 /nobreak >nul 2>&1
    if not defined NOPAUSE start "" "http://127.0.0.1:8080"
) else (
    echo ^>^> UI ja activa em http://127.0.0.1:8080 ^(recarrega a pagina para ver actualizacoes^).
)

node "scripts\notify.js" --success >nul 2>&1

echo [%date% %time%] FIM run-now ok >> "%LOG%"
call :limparLock

echo.
echo ^>^> Pipeline concluida com sucesso.
if not defined NOPAUSE pause
exit /b 0

REM ========================================================================
REM  Subroutinas (espelho do start.bat — partilham o mesmo lock file)
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

:erro
echo.
echo ^>^> ERRO: !MOTIVO!
echo [%date% %time%] ERRO run-now: !MOTIVO! ^(exit !EXITCODE!^) >> "%LOG%"
node "scripts\notify.js" --error "!MOTIVO!" >nul 2>&1
call :limparLock
if not defined NOPAUSE pause
exit /b !EXITCODE!
