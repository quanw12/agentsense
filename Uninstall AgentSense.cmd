@echo off
rem Double-click to remove AgentSense for the current Windows user. Your saved data is kept.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
pause
