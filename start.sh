#!/usr/bin/env bash
set -e

echo "========================================================"
echo "  INTERLOCK PS-006 Failover Demonstrator (Algo-Ancesstors)"
echo "========================================================"
echo ""

if [ ! -d "node_modules" ]; then
    echo "[1/4] Installing dependencies..."
    npm install
else
    echo "[1/4] Dependencies already installed."
fi

echo "[2/4] Generating Lab CA and Replica PKI Certificates..."
node scripts/generate-pki.mjs

echo "[3/4] Generating Prisma Client..."
npx prisma generate

echo "[4/4] Starting INTERLOCK Services..."
echo "- Starting Realtime Bridge on http://127.0.0.1:3033..."
node --loader tsx mini-services/realtime/index.ts &
REALTIME_PID=$!

cleanup() {
    echo "Stopping Realtime Bridge (PID: $REALTIME_PID)..."
    kill $REALTIME_PID 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "- Starting Next.js Control Room on http://localhost:3000..."
echo ""
echo "Control room will be available at: http://localhost:3000"
echo ""
npm run dev
