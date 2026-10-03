@echo off
REM One command to start everything: install, serve backend + frontend, open browser.
cd /d "%~dp0"
pip install -r requirements.txt
start "" http://127.0.0.1:8000
python -m uvicorn src.backend.app:app --reload
