@echo off
chcp 65001 >nul
cd /d "%~dp0"
title QJCRK - Component Supply Chain Platform

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
)

if not exist "node_modules\express" (
  echo Install failed. Please run: npm install
  pause
  exit /b 1
)

start "" http://localhost:3000
echo Starting server at http://localhost:3000 ...
call npm start
pause
