@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto missing_node
where npm >nul 2>&1
if errorlevel 1 goto missing_node
node scripts\check-runtime.mjs
if errorlevel 1 goto failed
if not exist "node_modules\.package-lock.json" (
  call npm ci
  if errorlevel 1 goto failed
)
node scripts\initialize-local-env.mjs
if errorlevel 1 goto failed
call npm run db:migrate
if errorlevel 1 goto failed
call npm run seed:demo
if errorlevel 1 goto failed
start "" /b node scripts\open-browser.mjs http://127.0.0.1:3000 >nul 2>&1
call npm run dev -- --port 3000
if errorlevel 1 goto failed
exit /b 0
:missing_node
echo Install Node.js 24 LTS and run this launcher again.
:failed
echo ActFlow stopped. Read the error above. Press any key to close.
pause >nul
exit /b 1
