@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)
if not exist "templates\layout.json" (
    echo Sheets not generated yet. Run setup.bat first.
    pause
    exit /b 1
)

rem Usage:  run.bat [extra app.py options]
rem   run.bat                 aquarium on port 8000; scan from phones at http://<this-pc>:8000/scan
rem   run.bat --webcam        also open the local webcam scanner window
rem   run.bat --clear         start with an empty aquarium
rem   run.bat --ttl 300       keep creatures 5 minutes instead of 2

set PORT=8000

echo Starting Sketch Aquarium...
echo   Aquarium: http://localhost:%PORT%   (press f in the browser for fullscreen)
echo   Scan page address is shown in the aquarium corner and below.
echo.

rem open the aquarium page once the server is up
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%"

".venv\Scripts\python.exe" -u app.py --port %PORT% %*

endlocal
