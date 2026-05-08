@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."

REM ========================================================================
REM  Fase 3: Análise das conversas com Claude Code (modo --print)
REM  Lê:   data\conversas.txt
REM  Gera: data\todo.json (via data\todo.json.tmp + validate.js)
REM  Logs: logs\analyzer.log
REM  Exit: 0=ok, 1=input em falta/vazio, 2=falha do claude, 3=output invalido
REM ========================================================================

REM 1. Verificar input
if not exist "data\conversas.txt" (
    echo ^>^> ERRO: data\conversas.txt nao existe. Corre o scraper primeiro.
    exit /b 1
)
for %%A in ("data\conversas.txt") do (
    if %%~zA==0 (
        echo ^>^> ERRO: data\conversas.txt esta vazio.
        exit /b 1
    )
)

REM 2. Garantir pasta logs
if not exist "logs" mkdir "logs"

REM 3. Limpar tmp antigo (caso execucao anterior tenha falhado a meio)
if exist "data\todo.json.tmp" del /q "data\todo.json.tmp"

REM 4. Data de hoje em formato ISO (YYYY-MM-DD)
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"`) do set "HOJE=%%d"
if not defined HOJE (
    echo ^>^> ERRO: nao foi possivel obter a data de hoje via powershell.
    exit /b 2
)

echo ^>^> Fase 3: a analisar conversas com Claude Sonnet 4.6 (hoje=%HOJE%)...

REM 5. Invocar Claude Code em modo --print
REM    - prompt.txt vai por stdin
REM    - data injectada via --append-system-prompt
REM    - stderr -> logs\analyzer.log (stdout do claude e ignorado: o JSON e
REM      escrito directamente para data\todo.json.tmp via tool Write)
type "analyzer\prompt.txt" | claude --print ^
    --model claude-sonnet-4-6 ^
    --dangerously-skip-permissions ^
    --append-system-prompt "Hoje e %HOJE%." ^
    1>nul 2>>"logs\analyzer.log"

if errorlevel 1 (
    echo ^>^> ERRO: claude --print falhou. Ver logs\analyzer.log
    exit /b 2
)

REM 6. Validar output (validate.js promove .tmp -> todo.json se OK)
node "analyzer\validate.js" 2>>"logs\analyzer.log"
if errorlevel 1 (
    echo ^>^> ERRO: todo.json invalido. Ver logs\analyzer.log
    exit /b 3
)

echo ^>^> OK: data\todo.json gerado e validado.
endlocal
exit /b 0
