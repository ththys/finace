@echo off
rem 마우스 오른쪽 → "관리자 권한으로 실행" 하세요.
rem 로그온할 때(2분 뒤) + 매일 18:00 에 kospi_update.bat 를 자동 실행하도록 등록합니다.
chcp 65001 > nul
cd /d "%~dp0"

rem 파이썬 위치 찾기 (Anaconda 포함)
set PY=
for /f "delims=" %%p in ('where python 2^>nul') do if not defined PY set PY=%%p
if not defined PY if exist "%USERPROFILE%\anaconda3\python.exe" set PY=%USERPROFILE%\anaconda3\python.exe
if not defined PY if exist "%USERPROFILE%\miniconda3\python.exe" set PY=%USERPROFILE%\miniconda3\python.exe
if not defined PY (
  echo 파이썬을 찾지 못했어요. 주피터 노트북에서 import sys; print(sys.executable) 결과를
  echo 이 폴더의 python_path.txt 에 한 줄로 적은 뒤 다시 실행하세요.
  if not exist python_path.txt ( pause & exit /b 1 )
) else (
  echo %PY%> python_path.txt
)
echo 파이썬: %PY%

schtasks /Create /TN "kospi_update_logon" /TR "\"%~dp0kospi_update.bat\"" /SC ONLOGON /DELAY 0002:00 /F
schtasks /Create /TN "kospi_update_1800" /TR "\"%~dp0kospi_update.bat\"" /SC DAILY /ST 18:00 /F
echo.
echo 등록 끝. 확인: 작업 스케줄러 앱에서 kospi_update_logon / kospi_update_1800
echo 지우려면: schtasks /Delete /TN kospi_update_logon /F  그리고  schtasks /Delete /TN kospi_update_1800 /F
pause
