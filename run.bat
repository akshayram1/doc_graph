@echo off
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo Run install.bat first.
  exit /b 1
)
if not exist "frontend\node_modules" (
  echo Run install.bat first.
  exit /b 1
)
if not exist ".env" (
  echo Missing .env. Copy .env.example to .env and fill it in.
  exit /b 1
)

node "%~dp0scripts\dev.js"
