@echo off
chcp 65001 > nul
cd /d "%USERPROFILE%\kospi"

echo [1/2] Updating prices...
python -u collect.py

echo.
echo [2/2] Starting dashboard... (close this window to stop)
python -m streamlit run app.py
