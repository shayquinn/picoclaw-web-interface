@echo off
echo Building PicoClaw for Windows...

REM Clean up old workspace copy
if exist cmd\picoclaw\internal\onboard\workspace (
    echo Cleaning old workspace...
    rmdir /S /Q cmd\picoclaw\internal\onboard\workspace
)

REM Copy workspace templates for embedding
echo Copying workspace templates...
xcopy /E /I /Y workspace cmd\picoclaw\internal\onboard\workspace > nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to copy workspace templates.
    pause
    exit /b 1
)

REM Build the binary
echo Building binary...
if not exist build mkdir build
go build -o build\picoclaw.exe .\cmd\picoclaw\
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)

REM Clean up workspace copy after build
echo Cleaning up...
rmdir /S /Q cmd\picoclaw\internal\onboard\workspace > nul 2>&1

echo Done: build\picoclaw.exe
