@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts/check.mjs
if errorlevel 1 goto end
node --test
:end
pause
