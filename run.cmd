@echo off
setlocal
cd /d "%~dp0"

REM --- Resolve the per-user "sadirano\yumi" home for the venv (kept OUT of the repo).
REM     The backup-worthy library lives separately under sadirano-data\yumi (see settings.py). ---
set "YUMI_BASE=%LOCALAPPDATA%"
if "%YUMI_BASE%"=="" set "YUMI_BASE=%USERPROFILE%\AppData\Local"
set "YUMI_HOME=%YUMI_BASE%\sadirano\yumi"
set "VENV=%YUMI_HOME%\.venv"
set "VPY=%VENV%\Scripts\python.exe"

REM --- Frontend: install deps (first run) + build into backend\app\static ---
echo [yumi] Building frontend...
cd frontend
if not exist "node_modules" (
    echo [yumi] Installing frontend deps...
    call npm install || goto :err
)
call npm run build || goto :err
cd ..

REM --- Backend: create venv OUTSIDE the repo (first run) + install deps ---
cd backend
if not exist "%VPY%" (
    echo [yumi] Creating venv at %VENV% ...
    py -m venv "%VENV%" || goto :err
    "%VPY%" -m pip install --upgrade pip || goto :err
    "%VPY%" -m pip install -e ".[dev]" || goto :err
)

set "URL=http://127.0.0.1:8765"
echo [yumi] Starting on %URL%
start "" "%URL%"
"%VPY%" -m uvicorn app.main:app --host 127.0.0.1 --port 8765
goto :eof

:err
echo [yumi] Startup failed.
exit /b 1
