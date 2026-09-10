@echo off
setlocal
cd /d "%~dp0"

echo === Sketch Aquarium setup ===

where python >nul 2>nul
if errorlevel 1 (
    echo Python was not found on PATH. Install Python 3.10+ from https://www.python.org and re-run.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo Failed to create the virtual environment.
        pause
        exit /b 1
    )
)

echo Installing dependencies...
".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
".venv\Scripts\python.exe" -m pip install --quiet -r requirements.txt
if errorlevel 1 (
    echo Dependency install failed.
    pause
    exit /b 1
)

echo Generating printable sheets...
".venv\Scripts\python.exe" templates.py
if errorlevel 1 (
    echo Sheet generation failed.
    pause
    exit /b 1
)

echo.
echo Opening port 8000 in Windows Firewall so phones on the Wi-Fi can reach the scan page...
netsh advfirewall firewall show rule name="Sketch Aquarium" >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "Start-Process netsh -Verb RunAs -Wait -ArgumentList 'advfirewall firewall add rule name=\"Sketch Aquarium\" dir=in action=allow protocol=TCP localport=8000'" 2>nul
    netsh advfirewall firewall show rule name="Sketch Aquarium" >nul 2>nul
    if errorlevel 1 (
        echo   Could not add the firewall rule automatically. To let phones connect, run as Administrator:
        echo   netsh advfirewall firewall add rule name="Sketch Aquarium" dir=in action=allow protocol=TCP localport=8000
    ) else (
        echo   Firewall rule added.
    )
) else (
    echo   Firewall rule already present.
)

echo.
echo Setup complete.
echo   Print:  templates\all_sheets.pdf
echo   Start:  run.bat
echo.
choice /c YN /n /m "Add demo creatures and run the self-test now? [Y/N] "
if errorlevel 2 goto done
".venv\Scripts\python.exe" make_synthetic.py

:done
pause
endlocal
