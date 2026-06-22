@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\build.ps1" -Root "%ROOT%"
if errorlevel 1 (
    echo ERROR: Build failed. See output above.
    exit /b 1
)

endlocal
