@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0\.."

echo ============================================================
echo  Desinstalacao do WhatsApp Task Extractor
echo ------------------------------------------------------------
echo  NAO sera apagado: data\, logs\, codigo-fonte
echo  Cada passo destrutivo pede confirmacao individual.
echo ============================================================
echo.

set /p CONFIRMA="Continuar? (s/N): "
if /i not "!CONFIRMA!"=="s" (
    echo Cancelado.
    exit /b 0
)

echo.
echo --- 1. Tarefa do Task Scheduler ---
schtasks /query /tn "WhatsAppTodo" >nul 2>&1
if errorlevel 1 (
    echo [skip] tarefa "WhatsAppTodo" nao existe
) else (
    set /p R1="Apagar tarefa do Task Scheduler? (s/N): "
    if /i "!R1!"=="s" (
        schtasks /delete /tn "WhatsAppTodo" /f
    )
)

echo.
echo --- 2. Servidor UI em execucao (porto 8080) ---
set "UIPID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING" 2^>nul') do set "UIPID=%%P"
if not defined UIPID (
    echo [skip] sem servidor UI activo no porto 8080
) else (
    set /p R2="Terminar processo PID !UIPID! (servidor UI)? (s/N): "
    if /i "!R2!"=="s" (
        taskkill /F /PID !UIPID!
    )
)

echo.
echo --- 3. Sessao WhatsApp ---
if exist "session\*" (
    set /p R3="Apagar session\ ^(logout do WhatsApp Web^)? (s/N): "
    if /i "!R3!"=="s" (
        rmdir /s /q "session"
        echo session\ removida.
    )
) else (
    echo [skip] session\ vazia ou inexistente
)

echo.
echo --- 4. node_modules ---
set /p R4="Apagar scraper\node_modules\ e scripts\node_modules\? (s/N): "
if /i "!R4!"=="s" (
    if exist "scraper\node_modules" (
        rmdir /s /q "scraper\node_modules"
        echo scraper\node_modules\ removida.
    )
    if exist "scripts\node_modules" (
        rmdir /s /q "scripts\node_modules"
        echo scripts\node_modules\ removida.
    )
)

echo.
echo --- 5. Lock file ---
if exist "data\.lock" (
    del /q "data\.lock"
    echo data\.lock removido.
)

echo.
echo === Desinstalacao concluida. ===
echo Preservado: data\, logs\, codigo-fonte
exit /b 0
