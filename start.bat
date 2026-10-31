@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo   INTERLOCK PS-006 Failover Demonstrator (Algo-Ancesstors)
echo ========================================================
echo.

if not exist node_modules (
    echo [1/4] Installing dependencies...
    call npm install
) else (
    echo [1/4] Dependencies already installed.
)

echo [2/4] Generating Lab CA and Replica PKI Certificates...
node scripts/generate-pki.mjs

echo [3/4] Generating Prisma Client and Database Schema...
call npx prisma generate
if not defined DATABASE_URL set DATABASE_URL=file:./dev.db
call npx prisma db push --skip-generate --accept-data-loss

echo [4/4] Starting INTERLOCK Services...
echo - Starting Realtime Bridge on http://127.0.0.1:3033...
start "INTERLOCK Realtime Bridge" /min cmd /c "node --loader tsx mini-services/realtime/index.ts"

echo - Starting Next.js Control Room on http://localhost:3000...
echo.
echo Control room will be available at: http://localhost:3000
echo.
call npm run dev
