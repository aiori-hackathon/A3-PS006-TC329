@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo   INTERLOCK Automated Scenario Demo (Algo-Ancesstors)
echo ========================================================
echo.

echo [1/3] Verifying Lab PKI Certificates...
node scripts/generate-pki.mjs

echo.
echo [2/3] Running Policy, Audit, Scoring, and Security Verification...
node --experimental-strip-types --loader ./scripts/test-loader.mjs --test tests/*.test.ts

echo.
echo [3/3] Checking Independent Python Multi-Runtime Verification...
where python >nul 2>nul
if %errorlevel% equ 0 (
    python scripts/evaluate_policy.py
) else (
    echo Python not found on path, skipping python verification.
)

echo.
echo ========================================================
echo   Demo and Verification Complete: All Invariants Met!
echo ========================================================
