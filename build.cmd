@echo off
setlocal
cd /d "%~dp0"

REM Build a distributable yumi.exe and zip it for a GitHub release / Scoop manifest.
REM Reuses the same per-user venv that run.cmd creates under sadirano\yumi (kept OUT
REM of the repo). User data lives separately under sadirano-data\yumi (see settings.py).

set "YUMI_BASE=%LOCALAPPDATA%"
if "%YUMI_BASE%"=="" set "YUMI_BASE=%USERPROFILE%\AppData\Local"
set "YUMI_HOME=%YUMI_BASE%\sadirano\yumi"
set "VPY=%YUMI_HOME%\.venv\Scripts\python.exe"

if not exist "%VPY%" (
    echo [build] No venv found. Run .\run.cmd once first to create it.
    exit /b 1
)

REM --- Read the version from pyproject so the artifact name matches autoupdate ---
for /f "usebackq delims=" %%v in (`"%VPY%" -c "import tomllib;print(tomllib.load(open(r'%~dp0backend\pyproject.toml','rb'))['project']['version'])"`) do set "VERSION=%%v"
if "%VERSION%"=="" (
    echo [build] Could not read version from backend\pyproject.toml.
    exit /b 1
)
set "ARTIFACT=yumi-v%VERSION%-windows-amd64.zip"

REM --- 1. Frontend: build the SPA into backend\app\static ---
echo [build] Building frontend...
cd frontend
if not exist "node_modules" call npm install || goto :err
call npm run build || goto :err
cd ..

REM --- 2. Ensure backend + PyInstaller are installed in the venv ---
echo [build] Installing build dependencies...
"%VPY%" -m pip install -e "backend[build]" || goto :err

REM --- 3. Freeze: dist\yumi\yumi.exe (one-dir) ---
echo [build] Freezing with PyInstaller...
cd backend
"%VPY%" -m PyInstaller --noconfirm --clean --distpath "%~dp0dist" --workpath "%~dp0build" yumi.spec || goto :err
cd ..

REM --- 4. Zip dist\yumi\* -> dist\%ARTIFACT% (yumi.exe + _internal\ at zip root) ---
echo [build] Packaging dist\%ARTIFACT%...
powershell -NoProfile -Command "Compress-Archive -Path '%~dp0dist\yumi\*' -DestinationPath '%~dp0dist\%ARTIFACT%' -Force" || goto :err

echo [build] Done. Artifact: dist\%ARTIFACT%
echo [build] SHA256 (for the Scoop manifest hash):
certutil -hashfile "%~dp0dist\%ARTIFACT%" SHA256 | findstr /r /v "hash CertUtil"
goto :eof

:err
echo [build] Build failed.
exit /b 1
