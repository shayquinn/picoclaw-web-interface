@echo off
setlocal enabledelayedexpansion
echo ============================================================
echo  PicoClaw Full Build (Go binary + Electron installer)
echo ============================================================

REM ── Prerequisite checks ──────────────────────────────────────────────────────

where go >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: 'go' not found in PATH.
    echo        Install Go from https://go.dev/dl/ and re-run this script.
    pause
    exit /b 1
)

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: 'node' not found in PATH.
    echo        Install Node.js from https://nodejs.org/ and re-run this script.
    pause
    exit /b 1
)

where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: 'npm' not found in PATH.
    echo        Install Node.js (includes npm) from https://nodejs.org/ and re-run this script.
    pause
    exit /b 1
)

REM ── Go generate (workspace embedding) ────────────────────────────────────────

echo.
echo [1/5] Running go generate...

REM Clean up any stale workspace copy first
if exist cmd\picoclaw\internal\onboard\workspace (
    echo       Cleaning stale workspace copy...
    rmdir /S /Q cmd\picoclaw\internal\onboard\workspace
)

go generate ./...
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: 'go generate' failed.
    echo        If the generate step doesn't copy the workspace automatically,
    echo        the script will fall back to xcopy below.
)

REM Fallback: if go generate didn't copy the workspace, do it manually
if not exist cmd\picoclaw\internal\onboard\workspace (
    echo       Workspace not found after generate – copying manually...
    xcopy /E /I /Y workspace cmd\picoclaw\internal\onboard\workspace >nul
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to copy workspace templates.
        pause
        exit /b 1
    )
)

REM ── Build Go binary ───────────────────────────────────────────────────────────

echo.
echo [2/5] Building Go binary...

if not exist build mkdir build

go build -v -tags stdjson -o build\picoclaw-windows-amd64.exe .\cmd\picoclaw
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Go build failed.
    pause
    exit /b 1
)

REM Copy to plain picoclaw.exe so dev-mode Electron can find it without the platform suffix
copy /Y build\picoclaw-windows-amd64.exe build\picoclaw.exe >nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to copy picoclaw-windows-amd64.exe to picoclaw.exe.
    pause
    exit /b 1
)

echo       Built: build\picoclaw-windows-amd64.exe

REM ── Clean up embedded workspace copy ─────────────────────────────────────────

echo.
echo [3/5] Cleaning up embedded workspace copy...
if exist cmd\picoclaw\internal\onboard\workspace (
    rmdir /S /Q cmd\picoclaw\internal\onboard\workspace
)

REM ── Node dependencies ─────────────────────────────────────────────────────────

echo.
echo [4/5] Installing Node dependencies...

cd web-interface

if not exist node_modules (
    echo       node_modules not found – running npm install...
    npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: npm install failed.
        cd ..
        pause
        exit /b 1
    )
) else (
    echo       node_modules already present – skipping npm install.
)

REM ── Build Electron installer ──────────────────────────────────────────────────

echo.
echo [5/5] Building Electron installer (npm run dist:win)...

npm run dist:win
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Electron build failed.
    cd ..
    pause
    exit /b 1
)

cd ..

echo.
echo ============================================================
echo  Build complete!
echo  Go binary  : build\picoclaw-windows-amd64.exe
echo  Installer  : web-interface\dist\
echo ============================================================
pause
