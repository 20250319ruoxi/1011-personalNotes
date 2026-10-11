@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   personalNodes  -  dev server launcher
echo ==========================================
echo.

set "PY=.venv\Scripts\python.exe"

rem ---- 1) virtualenv ----
if exist "%PY%" goto :venv_ok
echo [1/3] .venv not found - creating it ...
where python >nul 2>nul
if errorlevel 1 goto :no_python
python -m venv .venv
if errorlevel 1 goto :fail
echo       installing dependencies (Tsinghua mirror) ...
"%PY%" -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
if errorlevel 1 goto :fail
goto :venv_done

:venv_ok
echo [1/3] .venv OK

:venv_done

rem ---- 2) database ----
if exist "db\app.db" goto :db_ok
echo [2/3] db\app.db not found - running init-db ...
"%PY%" app.py init-db
if errorlevel 1 goto :fail
goto :db_done

:db_ok
echo [2/3] db\app.db OK

:db_done

rem ---- 3) serve ----
echo [3/3] starting dev server on http://127.0.0.1:5000
echo       browser will open in a few seconds
echo       press Ctrl+C in this window to stop
echo.
start "" /b cmd /c "timeout /t 4 /nobreak >nul && start http://127.0.0.1:5000"
"%PY%" app.py run
echo.
echo Server stopped.
pause
exit /b 0

:no_python
echo ERROR: "python" not found on PATH. Install Python 3.10+ first.
pause
exit /b 1

:fail
echo.
echo ERROR: startup failed. Check the messages above.
pause
exit /b 1
