@echo off
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  where py >nul 2>&1
  if %errorlevel%==0 (
    py -3 -m venv backend\.venv
  ) else (
    python -m venv backend\.venv
  )
  if errorlevel 1 (
    echo Could not create the Python virtual environment. Install Python 3 and try again.
    exit /b 1
  )
)

set "PY=backend\.venv\Scripts\python.exe"
"%PY%" -m pip install --upgrade pip
if errorlevel 1 exit /b 1
"%PY%" -m pip install -r backend\requirements.txt
if errorlevel 1 exit /b 1

call npm install --prefix frontend
if errorlevel 1 exit /b 1

echo.
echo Install finished. Next, run: run.bat
