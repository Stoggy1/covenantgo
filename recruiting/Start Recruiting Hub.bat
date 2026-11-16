@echo off
title Recruiting Hub (keep this window open)
cd /d "%~dp0"
start "" /b cmd /c "timeout /t 2 /nobreak >/dev/null & start http://localhost:5190"
node server.mjs
pause
