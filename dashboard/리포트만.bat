@echo off
chcp 65001 > nul
cd /d "%~dp0"
rem --- 관심종목 리포트만 받아서 사이트(로그인 화면)에 올리기 · 1~3분 ---
set "PY="
if exist "%~dp0python_path.txt" set /p PY=<"%~dp0python_path.txt"
if not defined PY if exist "%USERPROFILE%\anaconda3\python.exe" set "PY=%USERPROFILE%\anaconda3\python.exe"
if not defined PY if exist "%USERPROFILE%\miniconda3\python.exe" set "PY=%USERPROFILE%\miniconda3\python.exe"
if not defined PY if exist "C:\ProgramData\anaconda3\python.exe" set "PY=C:\ProgramData\anaconda3\python.exe"
if not defined PY for /f "delims=" %%p in ('where python 2^>nul') do if not defined PY set "PY=%%p"
if not defined PY (
  echo [오류] 파이썬을 찾지 못했어요.
  pause
  exit /b 1
)
"%PY%" -u updater.py
echo [리포트만] 관심종목 리포트 받기 + 사이트에 올리기...
"%PY%" -u reports.py
if errorlevel 1 (
  echo [오류] 위 내용을 캡처해 주세요.
  pause
  exit /b 1
)
start "" "https://ththys.github.io/finace/#reports"
timeout /t 10
