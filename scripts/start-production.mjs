/**
 * Production Process Orchestrator for Render / Cloud Hosting.
 * Spawns the Realtime WebSocket Bridge on port 3033 and the Next.js Standalone
 * application on PORT (defaults to 3000).
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const PORT = process.env.PORT || "3000";
const HOSTNAME = "0.0.0.0";

console.log(`[PRODUCTION] Starting INTERLOCK on port ${PORT}...`);

// 1. Start Realtime Bridge on 3033
console.log(`[PRODUCTION] Spawning Realtime WebSocket Bridge on port 3033...`);
const realtime = spawn("node", ["mini-services/realtime/index.js"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    REALTIME_PORT: process.env.REALTIME_PORT || "3033",
    REALTIME_TOKEN: process.env.REALTIME_TOKEN || "interlock-dev-token",
  },
});

realtime.on("error", (err) => {
  console.error("[REALTIME ERROR]", err);
});

// 2. Start Next.js Standalone Server on PORT
console.log(`[PRODUCTION] Starting Next.js Web Application on ${HOSTNAME}:${PORT}...`);
const web = spawn("node", [".next/standalone/server.js"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT,
    HOSTNAME,
    REALTIME_URL: `http://127.0.0.1:3033/publish`,
  },
});

web.on("error", (err) => {
  console.error("[NEXTJS ERROR]", err);
  process.exit(1);
});

function cleanup() {
  console.log("[PRODUCTION] Shutting down services...");
  realtime.kill();
  web.kill();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
