@echo off
cd /d "%~dp0"
echo ==========================================
echo   Starting Companion-Link Backend...
echo ==========================================

:: Check if .env exists
if not exist ".env" (
    echo [WARNING] .env file not found! creating from template...
    type .env.example > .env 2>nul
    if exist ".env" (
        echo [INFO] Created .env. Please edit it if needed.
    ) else (
        echo [ERROR] Could not create .env.
    )
)

:: Install dependencies if needed (simple check)
if not exist "venv" (
    echo [INFO] Creating Python virtual environment...
    python -m venv venv
    call venv\Scripts\activate
    echo [INFO] Installing requirements...
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate
)

:: Run server
echo [INFO] Launching FastAPI server...
python main.py

pause
