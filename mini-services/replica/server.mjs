/**
 * Standalone Physical Lab Replica Microservice (PS-006 FR-01, FR-02, FR-03, FR-04)
 * Serves real HTTPS traffic using Lab CA certificates with SAN URIs and location tags.
 * Exposes /health, /data, /meta and fault injection APIs.
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Profiles matching PRD and src/server/lab/replicas.ts
const PROFILES = {
  compliant:       { key: "compliant",       location: "IN", cert: "in",        tlsMin: "1.2", tlsMax: "1.3", logging: "minimal" },
  weak_tls:        { key: "weak_tls",        location: "IN", cert: "in",        tlsMin: "1.1", tlsMax: "1.1", logging: "minimal" },
  eu_weak_tls:     { key: "eu_weak_tls",     location: "EU", cert: "eu",        tlsMin: "1.1", tlsMax: "1.1", logging: "minimal" },
  wrong_location:  { key: "wrong_location",  location: "EU", cert: "eu",        tlsMin: "1.2", tlsMax: "1.3", logging: "minimal" },
  label_mismatch:  { key: "label_mismatch",  location: "IN", cert: "eu",        tlsMin: "1.2", tlsMax: "1.3", logging: "minimal" },
  verbose_logging: { key: "verbose_logging", location: "IN", cert: "in",        tlsMin: "1.2", tlsMax: "1.3", logging: "verbose" },
  untrusted_cert:  { key: "untrusted_cert",  location: "IN", cert: "untrusted", tlsMin: "1.2", tlsMax: "1.3", logging: "minimal" },
};

const CERT_LABEL = { in: "IN", eu: "EU", untrusted: "UNTRUSTED" };

// CLI / Env configuration
const REPLICA_ID = process.env.REPLICA_ID || (process.argv[2] || "A").toUpperCase();
const DEFAULT_PORT = REPLICA_ID === "A" ? 8443 : 8444;
const PORT = parseInt(process.env.PORT || process.env.REPLICA_PORT || String(DEFAULT_PORT), 10);
const USE_HTTPS = process.env.HTTPS_ENABLED !== "false";

let currentProfile = PROFILES[process.env.REPLICA_PROFILE] || PROFILES.compliant;
let activeFault = null; // null | "CRASH" | "LINK_LOSS" | "OVERLOAD"
let degradedMs = 2500;

function getPkiPaths(replicaId, profile) {
  const pkiBase = path.resolve(__dirname, "../../pki");
  if (replicaId === "A") {
    return {
      cert: path.join(pkiBase, "replica-a/tls.crt"),
      key: path.join(pkiBase, "replica-a/tls.key"),
    };
  }
  // Replica B
  switch (profile.key) {
    case "wrong_location":
      return {
        cert: path.join(pkiBase, "replica-b/wrong-location.crt"),
        key: path.join(pkiBase, "replica-b/compliant.key"),
      };
    case "label_mismatch":
      return {
        cert: path.join(pkiBase, "replica-b/label-mismatch.crt"),
        key: path.join(pkiBase, "replica-b/compliant.key"),
      };
    case "untrusted_cert":
      return {
        cert: path.join(pkiBase, "replica-b/untrusted.crt"),
        key: path.join(pkiBase, "replica-b/compliant.key"),
      };
    default:
      return {
        cert: path.join(pkiBase, "replica-b/compliant.crt"),
        key: path.join(pkiBase, "replica-b/compliant.key"),
      };
  }
}

function createServerOptions() {
  if (!USE_HTTPS) return {};
  const paths = getPkiPaths(REPLICA_ID, currentProfile);
  try {
    return {
      cert: fs.readFileSync(paths.cert),
      key: fs.readFileSync(paths.key),
      minVersion: currentProfile.tlsMin === "1.1" ? "TLSv1.1" : "TLSv1.2",
      maxVersion: currentProfile.tlsMax === "1.1" ? "TLSv1.1" : "TLSv1.3",
    };
  } catch (err) {
    console.warn(`[REPLICA ${REPLICA_ID}] PKI files not found at ${paths.cert}. Run 'node scripts/generate-pki.mjs' first. Falling back to HTTP.`);
    return null;
  }
}

let server;

function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Fault handling
  if (activeFault === "CRASH") {
    // Immediately destroy client socket to simulate process crash (ECONNRESET / ECONNREFUSED)
    req.socket.destroy();
    return;
  }

  if (activeFault === "LINK_LOSS") {
    // Hold socket without responding to simulate dropped packets / connect timeout
    return;
  }

  const handleRoute = () => {
    // Health endpoint (FR-01)
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        replicaId: REPLICA_ID,
        profile: currentProfile.key,
        uptime: process.uptime(),
      }));
      return;
    }

    // Data endpoint (FR-01)
    if (url.pathname === "/data") {
      if (currentProfile.logging === "verbose") {
        console.log(`[REPLICA ${REPLICA_ID} VERBOSE] Request ${req.method} ${req.url} - Headers:`, req.headers);
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "X-Served-By": REPLICA_ID,
        "X-Replica-Location": currentProfile.location,
      });
      res.end(JSON.stringify({
        servedBy: REPLICA_ID,
        location: currentProfile.location,
        timestamp: new Date().toISOString(),
        data: "interlock-payload-ok",
      }));
      return;
    }

    // Metadata endpoint (FR-01 & FR-02)
    if (url.pathname === "/meta") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        replicaId: REPLICA_ID,
        declaredLocation: currentProfile.location,
        certLocation: CERT_LABEL[currentProfile.cert],
        profile: currentProfile.key,
        tlsMin: currentProfile.tlsMin,
        tlsMax: currentProfile.tlsMax,
        loggingClaim: currentProfile.logging,
        legacyAccepted: currentProfile.tlsMin === "1.1" ? ["1.1"] : [],
      }));
      return;
    }

    // Fault injection API
    if (url.pathname === "/fault" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const data = JSON.parse(body || "{}");
          activeFault = data.fault || null;
          if (data.degradedMs) degradedMs = Number(data.degradedMs);
          console.log(`[REPLICA ${REPLICA_ID}] Fault injected: ${activeFault}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, activeFault, degradedMs }));
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    // Clear fault API
    if (url.pathname === "/clear-fault" && req.method === "POST") {
      activeFault = null;
      console.log(`[REPLICA ${REPLICA_ID}] All faults cleared.`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, activeFault: null }));
      return;
    }

    // Profile switch API
    if (url.pathname === "/profile" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const data = JSON.parse(body || "{}");
          if (PROFILES[data.profile]) {
            currentProfile = PROFILES[data.profile];
            console.log(`[REPLICA ${REPLICA_ID}] Profile changed to: ${currentProfile.key}`);
            restartServer();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, profile: currentProfile.key }));
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Unknown profile: ${data.profile}` }));
          }
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not Found" }));
  };

  if (activeFault === "OVERLOAD") {
    // Artificial latency delay (FR-42)
    setTimeout(handleRoute, degradedMs);
  } else {
    handleRoute();
  }
}

function startServer() {
  const tlsOpts = createServerOptions();
  if (USE_HTTPS && tlsOpts) {
    server = https.createServer(tlsOpts, requestHandler);
  } else {
    server = http.createServer(requestHandler);
  }

  server.listen(PORT, "0.0.0.0", () => {
    const proto = (USE_HTTPS && tlsOpts) ? "https" : "http";
    console.log(`[REPLICA ${REPLICA_ID}] Listening on ${proto}://0.0.0.0:${PORT} (Profile: ${currentProfile.key}, Location: ${currentProfile.location})`);
  });
}

function restartServer() {
  if (server) {
    server.close(() => {
      startServer();
    });
  } else {
    startServer();
  }
}

startServer();
