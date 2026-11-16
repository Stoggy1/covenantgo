@echo off
title Recruiting Hub - phone access ON (keep this window open)
cd /d "%~dp0"
set HOST=0.0.0.0
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5190/#settings"
node server.mjs
pause
