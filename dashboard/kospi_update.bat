@echo off
rem 화면 없이 데이터만 업데이트 (작업 스케줄러가 실행). 로그는 update.log
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
  exit /b 1
)
echo ===== %date% %time% ===== >> update.log
"%PY%" -u collect.py >> update.log 2>&1
