@echo off
setlocal
set ROOT=%~dp0
set ROOT=%ROOT:~0,-1%
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\build_Chrome.ps1" -Root "%ROOT%"
endlocal
