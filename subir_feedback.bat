@echo off
setlocal
cd /d "%~dp0"
title Subir FEEDBACK a GitHub

set "REPO=https://github.com/jamanteiga/FEEDBACK.git"
set "RAMA=main"

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git no esta instalado. Instalalo desde https://git-scm.com/download/win y vuelve a ejecutar.
  pause
  exit /b 1
)

echo ============================================================
echo  Se va a SOBREESCRIBIR por completo el repositorio:
echo    %REPO%  (rama %RAMA%)
echo  con el contenido de esta carpeta:
echo    %CD%
echo  Todo lo que haya ahora en el repositorio se perdera.
echo  Los PDF, imagenes y JSON NO se suben (ver .gitignore).
echo ============================================================
set /p OK=Escribe S para continuar: 
if /i not "%OK%"=="S" (
  echo Cancelado.
  pause
  exit /b 0
)

if not exist ".git" (
  git init -b %RAMA%
  if errorlevel 1 goto :fallo
)
git remote remove origin >nul 2>nul
git remote add origin %REPO%
if errorlevel 1 goto :fallo

git add -A
if errorlevel 1 goto :fallo
git commit -m "FEEDBACK %date% %time%"
rem Si no hay cambios nuevos, el commit anterior se vuelve a subir igualmente.

git branch -M %RAMA%
git push --force -u origin %RAMA%
if errorlevel 1 goto :fallo

echo.
echo [OK] Repositorio actualizado: https://github.com/jamanteiga/FEEDBACK
echo      Pages (si esta activado): https://jamanteiga.github.io/FEEDBACK/
pause
exit /b 0

:fallo
echo.
echo [ERROR] Algo ha fallado (ver mensajes arriba). Si pide inicio de sesion, usa tu cuenta jamanteiga.
pause
exit /b 1
