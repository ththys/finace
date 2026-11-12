@echo off
rem Right-click -> Run as administrator.
rem Registers kospi_update.bat to run at logon (+2 min) and daily at 18:00.
cd /d "%~dp0"
set "PY="
if exist "%~dp0python_path.txt" set /p PY=<"%~dp0python_path.txt"
if not defined PY if exist "%USERPROFILE%\anaconda3\python.exe" set "PY=%USERPROFILE%\anaconda3\python.exe"
if not defined PY if exist "%USERPROFILE%\miniconda3\python.exe" set "PY=%USERPROFILE%\miniconda3\python.exe"
if not defined PY if exist "C:\ProgramData\anaconda3\python.exe" set "PY=C:\ProgramData\anaconda3\python.exe"
if not defined PY for /f "delims=" %%p in ('where python 2^>nul') do if not defined PY set "PY=%%p"
if not defined PY (
  echo [ERROR] Python not found.
  echo In Jupyter run: import sys; print(sys.executable^)
  echo and save that path as one line in python_path.txt in this folder.
  pause
  exit /b 1
)
echo %PY%> python_path.txt
echo Python: %PY%

schtasks /Create /TN "kospi_update_logon" /TR "\"%~dp0kospi_update.bat\"" /SC ONLOGON /DELAY 0002:00 /F
schtasks /Create /TN "kospi_update_1800" /TR "\"%~dp0kospi_update.bat\"" /SC DAILY /ST 18:00 /F
echo.
echo Done. Check Task Scheduler for kospi_update_logon / kospi_update_1800
echo To remove: schtasks /Delete /TN kospi_update_logon /F  and  schtasks /Delete /TN kospi_update_1800 /F
pause
