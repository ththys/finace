@echo off
rem 화면 없이 데이터만 업데이트 (작업 스케줄러가 실행). 로그는 update.log
chcp 65001 > nul
cd /d "%~dp0"
set PY=python
if exist "%~dp0python_path.txt" set /p PY=<"%~dp0python_path.txt"
echo ===== %date% %time% ===== >> update.log
"%PY%" -u collect.py >> update.log 2>&1
