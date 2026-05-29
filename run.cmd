@echo off
setlocal
cd /d "%~dp0"

REM --- Frontend: install deps (first run) + build into backend\app\static ---
echo [yumi] Building frontend...
cd frontend
if not exist "node_modules" (
    echo [yumi] Installing frontend deps...
    call npm install || goto :err
)
call npm run build || goto :err
cd ..

REM --- Backend: create venv + install deps (first run) ---
cd backend
if not exist ".venv\Scripts\python.exe" (
    echo [yumi] Creating venv...
    py -m venv .venv || goto :err
    .\.venv\Scripts\python.exe -m pip install --upgrade pip || goto :err
    .\.venv\Scripts\python.exe -m pip install -e ".[dev]" || goto :err
)

set "URL=http://127.0.0.1:8765"
echo [yumi] Starting on %URL%
start "" "%URL%"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8765
goto :eof

:err
echo [yumi] Startup failed.
exit /b 1
