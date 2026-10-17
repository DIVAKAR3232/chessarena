@echo off
rem Double-click launcher for Windows: runs startup.sh with Git Bash.
setlocal
set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not exist "%BASH%" (
  echo Git Bash was not found. Install Git for Windows from https://git-scm.com/download/win
  pause
  exit /b 1
)
cd /d "%~dp0"
"%BASH%" ./startup.sh %*
pause
