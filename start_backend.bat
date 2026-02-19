@echo off
TITLE ST-Companion-Link Backend
cd /d %~dp0

echo [ST-Companion-Link] Starting Backend...

:: Check if .venv exists
if exist ".venv\Scripts\python.exe" (
    echo [Environment] Using .venv
    ".venv\Scripts\python.exe" backend/main.py
) else (
    echo [Environment] .venv not found, using system python
    python backend/main.py
)

if %ERRORLEVEL% neq 0 (
    echo.
    echo [Error] Backend failed to start.
    pause
)
