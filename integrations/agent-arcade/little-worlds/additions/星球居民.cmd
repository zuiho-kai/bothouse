@echo off
setlocal
chcp 65001 >nul
where py.exe >nul 2>nul
if not errorlevel 1 (
    py.exe -3 -I -c "import sys,tomllib,tkinter; assert sys.version_info >= (3,11)" >nul 2>nul
    if not errorlevel 1 goto py_ready
)
where python.exe >nul 2>nul
if errorlevel 1 goto missing
python.exe -I -c "import sys,tomllib,tkinter; assert sys.version_info >= (3,11)" >nul 2>nul
if errorlevel 1 goto missing
set "PYTHON_CMD=python.exe"
goto launch
:py_ready
set "PYTHON_CMD=py.exe -3"
:launch
%PYTHON_CMD% -I -c "import pathlib,subprocess,sys; subprocess.Popen([str(pathlib.Path(sys.executable).with_name('pythonw.exe')),'-I','-B',sys.argv[1]], close_fds=True)" "%~dp0scripts\resident_host.py"
if not errorlevel 1 exit /b 0
:missing
echo 请安装包含 Tcl/Tk 的 Windows Python 3.11 或更高版本，然后重新打开星球居民。
pause
exit /b 1
