#!/usr/bin/env bash
set -e

echo "========================================================"
echo "  INTERLOCK Automated Scenario Demo (Algo-Ancesstors)"
echo "========================================================"
echo ""

echo "[1/3] Verifying Lab PKI Certificates..."
node scripts/generate-pki.mjs

echo ""
echo "[2/3] Running Policy, Audit, Scoring, and Security Verification..."
node --experimental-strip-types --loader ./scripts/test-loader.mjs --test tests/*.test.ts

echo ""
echo "[3/3] Checking Independent Python Multi-Runtime Verification..."
if command -v python3 &>/dev/null; then
    python3 scripts/evaluate_policy.py
elif command -v python &>/dev/null; then
    python scripts/evaluate_policy.py
fi

echo ""
echo "========================================================"
echo "  Demo & Verification Complete: All Invariants Met!"
echo "========================================================"
