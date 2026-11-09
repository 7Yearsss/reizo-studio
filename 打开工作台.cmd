@echo off
cd /d "%~dp0"
node scripts/open-desktop-preview.mjs
if errorlevel 1 pause
