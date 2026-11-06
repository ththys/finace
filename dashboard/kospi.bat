@echo off
cd /d "%~dp0"
set PYTHONUTF8=1
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
echo Python: %PY%

echo [1/2] Updating data...
"%PY%" -u collect.py
if errorlevel 1 (
  echo.
  echo [ERROR] Update failed. Please capture the messages above.
  pause
)

echo.
echo [2/2] Starting dashboard... (close this window to stop)
"%PY%" -m streamlit run app.py
pause
