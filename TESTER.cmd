@echo off
setlocal
cd /d "%~dp0"
node scripts/check.mjs
if errorlevel 1 goto finish
node scripts/test.mjs
if errorlevel 1 goto finish
node scripts/smoke.mjs
:finish
pause
