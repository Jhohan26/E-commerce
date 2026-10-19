@echo off
setlocal
cd /d "%~dp0"
if not exist "C:\xampp\php\php.exe" (
  echo No se encontro C:\xampp\php\php.exe. Usa tu PHP con bin\console.php.
  exit /b 1
)
"C:\xampp\php\php.exe" "%~dp0bin\console.php" %*
exit /b %errorlevel%
