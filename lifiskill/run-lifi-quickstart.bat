@echo off
setlocal

REM Always run from this script's directory.
cd /d "%~dp0"

if not exist "package.json" (
  echo [ERROR] package.json not found in %cd%
  echo         Please place this script in the lifiskill project root.
  exit /b 1
)

REM Runtime auth and server settings.
if "%LIFISKILL_RUNTIME_TOKEN%"=="" set "LIFISKILL_RUNTIME_TOKEN=replace_with_secure_token"
if "%LIFISKILL_RUNTIME_HOST%"=="" set "LIFISKILL_RUNTIME_HOST=127.0.0.1"
if "%LIFISKILL_RUNTIME_PORT%"=="" set "LIFISKILL_RUNTIME_PORT=8787"

REM LI.FI integration toggles.
if "%LIFISKILL_USE_LIFI_API%"=="" set "LIFISKILL_USE_LIFI_API=true"
if "%LIFISKILL_USE_LIFI_EXECUTE%"=="" set "LIFISKILL_USE_LIFI_EXECUTE=false"
if "%LI_FI_INTEGRATOR%"=="" set "LI_FI_INTEGRATOR=lifiskill-runtime"
if "%LI_FI_BASE_URL%"=="" set "LI_FI_BASE_URL=https://li.quest/v1"

REM Optional hardening defaults.
if "%IP_ALLOWLIST%"=="" set "IP_ALLOWLIST=127.0.0.1/32"
if "%RUNTIME_TRUSTED_PROXY%"=="" set "RUNTIME_TRUSTED_PROXY=false"
if "%RUNTIME_LOG_ENABLED%"=="" set "RUNTIME_LOG_ENABLED=true"
if "%RUNTIME_LOG_FORMAT%"=="" set "RUNTIME_LOG_FORMAT=pretty"

echo.
echo [lifiskill quickstart]
echo   cwd: %cd%
echo   host: %LIFISKILL_RUNTIME_HOST%
echo   port: %LIFISKILL_RUNTIME_PORT%
echo   lifi api mode: %LIFISKILL_USE_LIFI_API%
echo   lifi execute mode: %LIFISKILL_USE_LIFI_EXECUTE%
echo   integrator: %LI_FI_INTEGRATOR%
echo.

if /I "%LIFISKILL_USE_LIFI_API%"=="true" (
  if "%LI_FI_API_KEY%"=="" (
    echo [WARN] LI_FI_API_KEY is empty. Public-rate limits may apply.
  ) else (
    echo [INFO] LI_FI_API_KEY is configured.
  )
)

echo.
echo Starting runtime server...
echo Press Ctrl+C to stop.
echo.

call npm.cmd run serve:runtime
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo [ERROR] runtime server exited with code %EXIT_CODE%.
) else (
  echo [INFO] runtime server exited normally.
)

exit /b %EXIT_CODE%
