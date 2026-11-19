@echo off
chcp 65001 >nul
REM Uso: indexar-lote.bat "C:\ruta\carpeta" "salida.fbp" CONTRASEÑA
if "%~3"=="" (echo Uso: indexar-lote.bat "carpeta" "salida.fbp" CONTRASEÑA & exit /b 2)
cd /d "%~dp0.."
if not exist node_modules\playwright-core (echo Instalando playwright-core una vez... & call npm i playwright-core --no-save)
node cli\indexar-lote.mjs "%~1" "%~2" --clave=%3
pause
