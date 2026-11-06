@echo off
chcp 65001 > nul
cd /d "%~dp0"
rem --- 파이썬 찾기: python_path.txt > Anaconda > PATH ---
set "PY="
if exist "%~dp0python_path.txt" set /p PY=<"%~dp0python_path.txt"
if not defined PY if exist "%USERPROFILE%\anaconda3\python.exe" set "PY=%USERPROFILE%\anaconda3\python.exe"
if not defined PY if exist "%USERPROFILE%\miniconda3\python.exe" set "PY=%USERPROFILE%\miniconda3\python.exe"
if not defined PY if exist "C:\ProgramData\anaconda3\python.exe" set "PY=C:\ProgramData\anaconda3\python.exe"
if not defined PY for /f "delims=" %%p in ('where python 2^>nul') do if not defined PY set "PY=%%p"
if not defined PY (
  echo [오류] 파이썬을 찾지 못했어요.
  echo 주피터에서 import sys; print(sys.executable^) 결과를 이 폴더의 python_path.txt 에 한 줄로 적어 주세요.
  pause
  exit /b 1
)
echo 파이썬: %PY%

echo [1/2] 데이터 업데이트...
"%PY%" -u collect.py
if errorlevel 1 (
  echo.
  echo [오류] 업데이트 중 문제가 생겼어요. 위 내용을 캡처해 주세요.
  pause
)

echo.
echo [2/2] 대시보드 실행... (이 창을 닫으면 꺼져요)
"%PY%" -m streamlit run app.py
pause
