@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0\.."

set "FALHAS=0"

echo === Verificacao de pre-requisitos ===
echo.

call :checkCmd "node CLI" "node --version"
call :checkCmd "claude CLI" "claude --version"
call :checkDir "session\ (autenticacao WhatsApp)" "session"
call :checkDir "scraper\node_modules\" "scraper\node_modules"
call :checkDir "scripts\node_modules\" "scripts\node_modules"
call :checkFile "analyzer\prompt.txt" "analyzer\prompt.txt"
call :checkFile "ui\server.js" "ui\server.js"
call :checkFile "ui\index.html" "ui\index.html"

echo.
if !FALHAS!==0 (
    echo === Tudo pronto. ===
    exit /b 0
) else (
    echo === Faltam !FALHAS! coisa^(s^). Resolve antes de correr o pipeline. ===
    exit /b 1
)

:checkCmd
%~2 >nul 2>&1
if errorlevel 1 (
    echo [FALHA] %~1
    set /a FALHAS+=1
) else (
    echo [ OK  ] %~1
)
exit /b 0

:checkDir
if exist "%~2\*" (
    echo [ OK  ] %~1
) else (
    echo [FALHA] %~1
    set /a FALHAS+=1
)
exit /b 0

:checkFile
if not exist "%~2" (
    echo [FALHA] %~1 ^(em falta^)
    set /a FALHAS+=1
    exit /b 0
)
for %%A in ("%~2") do (
    if %%~zA==0 (
        echo [FALHA] %~1 ^(vazio^)
        set /a FALHAS+=1
    ) else (
        echo [ OK  ] %~1
    )
)
exit /b 0
