@echo off
setlocal enabledelayedexpansion

title DocLens - Document Intelligence ^& Fraud Detection

:: Ensure working directory is the project folder
cd /d "%~dp0"

echo ======================================================================
echo                DocLens Setup and Startup Assistant
echo ======================================================================
echo(

:: 1. Check if Node.js is accessible
where node >nul 2>&1
if !errorlevel! neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=%PATH%;C:\Program Files\nodejs"
    ) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
        set "PATH=%PATH%;C:\Program Files (x86)\nodejs"
    ) else if exist "%LOCALAPPDATA%\Programs\node.exe" (
        set "PATH=%PATH%;%LOCALAPPDATA%\Programs"
    ) else if exist "%APPDATA%\npm\node.exe" (
        set "PATH=%PATH%;%APPDATA%\npm"
    )
)

where node >nul 2>&1
if !errorlevel! neq 0 (
    echo [ERROR] Node.js was not found on your system PATH or common directories.
    echo(
    echo DocLens requires Node.js v22.5.0 or newer ^(with native node:sqlite support^).
    echo(
    echo Please install Node.js:
    echo   1. Download from https://nodejs.org/
    echo   2. Or install via terminal: winget install OpenJS.NodeJS.LTS
    echo(
    pause
    exit /b 1
)

:: 2. Check Node.js version
for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODE_VERSION=%%v"
echo [OK] Found Node.js !NODE_VERSION!

:: Check if Node is at least version 22
node -e "const major = parseInt(process.versions.node.split('.')[0], 10); process.exit(major >= 22 ? 0 : 1)" >nul 2>&1
if !errorlevel! neq 0 (
    echo [WARNING] DocLens uses native SQLite ^(node:sqlite^) which requires Node.js v22.5.0+.
    echo Your current version is !NODE_VERSION!. If the server fails to start, please upgrade Node.js.
    echo(
)

:: 3. Check for dependencies / node_modules
echo [..] Checking dependencies...
set "NEEDS_INSTALL=0"
if not exist "node_modules\" set "NEEDS_INSTALL=1"
if not exist "node_modules\express\" set "NEEDS_INSTALL=1"
if not exist "node_modules\multer\" set "NEEDS_INSTALL=1"
if not exist "node_modules\pdf-parse\" set "NEEDS_INSTALL=1"
if not exist "node_modules\tesseract.js\" set "NEEDS_INSTALL=1"

if "!NEEDS_INSTALL!"=="1" (
    echo [..] Dependencies missing or incomplete. Running npm install...
    call npm install
    if !errorlevel! neq 0 (
        echo(
        echo [ERROR] npm install encountered an error. Please check your internet connection and try again.
        pause
        exit /b !errorlevel!
    )
    echo [OK] All dependencies successfully installed.
) else (
    echo [OK] Dependencies are already installed.
)

:: 4. Ensure storage directories exist
if not exist "data\" mkdir "data"
if not exist "data\uploads\" mkdir "data\uploads"

:: 5. Set default environment settings if not already provided
if "%PORT%"=="" set "PORT=3000"
if "%HOST%"=="" set "HOST=127.0.0.1"

echo(
echo ======================================================================
echo    DocLens is launching!
echo    URL: http://localhost:%PORT%
echo    Data Storage: %~dp0data
echo(
echo    Press Ctrl+C in this terminal window to stop the server.
echo ======================================================================
echo(

:: 6. Launch browser in background after short delay
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%"

:: 7. Start the DocLens server
node server/index.js

:: If the server stopped or crashed, pause so the user can read the output
if !errorlevel! neq 0 (
    echo(
    echo [INFO] DocLens server exited with code !errorlevel!.
    pause
)
