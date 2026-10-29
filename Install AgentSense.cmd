@echo off
rem Double-click to install AgentSense for the current Windows user. Works from any folder, including paths with spaces.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
pause
