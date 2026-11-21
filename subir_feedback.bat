@echo off
rem ============================================================
rem  subir_feedback.bat - SIN PREGUNTAS
rem
rem  subir_feedback.bat            doble clic: sincroniza, descomprime el zip
rem                                 (si hay) y sube a GitHub.
rem  subir_feedback.bat /auto      igual, sin pausas (log en %TEMP%\feedback_sync.log)
rem  subir_feedback.bat /instalar  crea una tarea que ejecuta /auto cada 10 minutos
rem                                 (asi el PC recibe solo lo que se suba desde la nube)
rem  subir_feedback.bat /quitar    borra esa tarea
rem  subir_feedback.bat /forzar    descarta cambios locales y se queda con GitHub
rem ============================================================
setlocal EnableExtensions
rem --- se ejecuta desde una copia en TEMP para poder sobreescribirse a si mismo
if /i not "%~1"=="/run" (
  copy /y "%~f0" "%TEMP%\_subir_fb.bat" >nul
  call "%TEMP%\_subir_fb.bat" /run "%~dp0" %*
  exit /b %errorlevel%
)
set "DIR=%~2"
set "AUTO=0"
set "FORZAR=0"
set "MODO="
for %%A in (%3 %4 %5) do (
  if /i "%%~A"=="/auto" set "AUTO=1"
  if /i "%%~A"=="/forzar" set "FORZAR=1"
  if /i "%%~A"=="/instalar" set "MODO=instalar"
  if /i "%%~A"=="/quitar" set "MODO=quitar"
)
set "REPO=https://github.com/jamanteiga/FEEDBACK.git"
set "RAMA=main"
title Subir FEEDBACK a GitHub

if "%MODO%"=="instalar" goto :instalar
if "%MODO%"=="quitar" goto :quitar
if "%AUTO%"=="1" goto :auto
call :trabajo
set "RC=%errorlevel%"
if "%RC%"=="0" (
  timeout /t 5 >nul
) else (
  pause
)
exit /b %RC%

:auto
set "GIT_TERMINAL_PROMPT=0"
call :trabajo >> "%TEMP%\feedback_sync.log" 2>&1
exit /b %errorlevel%

:instalar
schtasks /create /tn "FEEDBACK sync" /sc minute /mo 10 /f /tr "powershell -NoProfile -WindowStyle Hidden -Command \"& '%DIR%subir_feedback.bat' /auto\""
if errorlevel 1 goto :falloTarea
echo.
echo [OK] Tarea "FEEDBACK sync" creada: se ejecuta cada 10 minutos.
echo      Si dejas un feedback-web-v*.zip en esta carpeta o en Descargas, se descomprime y se sube.
echo      Si subo cambios desde la nube, tu carpeta se actualiza sola.
echo      Registro: %TEMP%\feedback_sync.log
pause
exit /b 0

:quitar
schtasks /delete /tn "FEEDBACK sync" /f
pause
exit /b 0

:falloTarea
echo.
echo [ERROR] No se pudo crear la tarea programada.
pause
exit /b 1

:trabajo
cd /d "%DIR%" || exit /b 1
echo.
echo ===== FEEDBACK sync %date% %time% =====
where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git no esta instalado: https://git-scm.com/download/win
  exit /b 1
)
if not exist ".git" git init -b %RAMA% >nul
git remote remove origin >nul 2>nul
git remote add origin %REPO%
git config user.name >nul 2>nul || git config user.name "jamanteiga"
git config user.email >nul 2>nul || git config user.email "jamanteiga@users.noreply.github.com"

echo [1/4] Consultando GitHub...
git fetch origin %RAMA% || goto :fallo

set "ZIP="
for /f "usebackq delims=" %%Z in (`powershell -NoProfile -Command "Get-ChildItem -Path '%DIR%','%USERPROFILE%\Downloads' -Filter 'feedback-web-v*.zip' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"`) do set "ZIP=%%Z"

set "SINHEAD=0"
git rev-parse --verify -q HEAD >nul 2>nul || set "SINHEAD=1"
set "BEHIND=0"
set "AHEAD=0"
set "DIRTY=0"
if "%SINHEAD%"=="1" (
  set "BEHIND=1"
) else (
  for /f %%N in ('git rev-list --count HEAD..origin/%RAMA%') do set "BEHIND=%%N"
  for /f %%N in ('git rev-list --count origin/%RAMA%..HEAD') do set "AHEAD=%%N"
  for /f %%L in ('git status --porcelain') do set "DIRTY=1"
)
set "LOCAL=0"
if not "%DIRTY%"=="0" set "LOCAL=1"
if not "%AHEAD%"=="0" set "LOCAL=1"
if defined ZIP set "LOCAL=0"
if "%FORZAR%"=="1" set "LOCAL=0"

if "%LOCAL%"=="1" if not "%BEHIND%"=="0" (
  echo [AVISO] Hay cambios locales sin subir y GitHub tiene cambios nuevos. No se toca nada.
  echo         Ejecuta subir_feedback.bat /forzar para quedarte con la version de GitHub.
  exit /b 1
)

echo [2/4] Sincronizando carpeta con GitHub...
if "%FORZAR%"=="1" set "BEHIND=1"
if not "%BEHIND%"=="0" (
  git reset -q origin/%RAMA% >nul 2>nul
  git reset -q --hard origin/%RAMA% || goto :fallo
)

if defined ZIP (
  echo     Descomprimiendo: %ZIP%
  powershell -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%DIR%' -Force" || goto :fallo
  del /q "%ZIP%"
) else (
  echo     No hay zip nuevo.
)

echo [3/4] Comprobando cambios y seguridad...
git add -A || goto :fallo
git diff --cached --quiet
set "HAYCAMBIOS=%errorlevel%"
if "%HAYCAMBIOS%"=="0" if "%AHEAD%"=="0" (
  echo [OK] Todo al dia: no hay nada que subir.
  exit /b 0
)
if "%HAYCAMBIOS%"=="1" (
  git diff --cached --name-only --diff-filter=AM | findstr /i /r "\.pdf$ \.docx*$ \.xlsx*$ \.xlsm$ \.pptx*$ \.msg$ \.eml$ \.tiff*$ \.jpe*g$ \.dwg$ \.dgn$ \.dxf$ \.zip$ \.fb[dvkp]$" >nul
  if not errorlevel 1 (
    echo [ERROR] Posible documento entre los cambios. NO se sube nada:
    git diff --cached --name-only --diff-filter=AM | findstr /i /r "\.pdf$ \.docx*$ \.xlsx*$ \.xlsm$ \.pptx*$ \.msg$ \.eml$ \.tiff*$ \.jpe*g$ \.dwg$ \.dgn$ \.dxf$ \.zip$ \.fb[dvkp]$"
    git reset -q
    exit /b 1
  )
  git commit -q -m "FEEDBACK %date% %time%" || goto :fallo
)

echo [4/4] Subiendo a GitHub...
git push origin %RAMA% || goto :fallo
echo.
echo [OK] Repositorio actualizado: https://github.com/jamanteiga/FEEDBACK
echo      Pages: https://jamanteiga.github.io/FEEDBACK/  (Ctrl+F5 si no ves el cambio)
exit /b 0

:fallo
echo.
echo [ERROR] Algo ha fallado (ver mensajes arriba). Si pide inicio de sesion, usa tu cuenta jamanteiga.
exit /b 1
