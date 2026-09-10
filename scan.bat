@echo off
setlocal
cd /d "%~dp0"
rem Drag one or more photos (.jpg/.png) of colored sheets onto this file to add them
rem to the aquarium. Works whether or not run.bat is currently running.
if not exist ".venv\Scripts\python.exe" (
    echo Run setup.bat first.
    pause
    exit /b 1
)
if "%~1"=="" (
    echo Drag photos onto scan.bat, or run:  scan.bat photo1.jpg photo2.jpg
    pause
    exit /b 1
)
".venv\Scripts\python.exe" -u scanner.py %*
pause
endlocal
