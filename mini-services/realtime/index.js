import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  MAX_PAYLOAD_BYTES,
  ALLOWED_EVENT_TYPES,
  verifyRealtimeToken,
  isValidEvent,
} from "./validator.js";

const PORT = Number(process.env.REALTIME_PORT ?? 3033) || 3033;
const TOKEN = process.env.REALTIME_TOKEN ?? "interlock-dev-token";
const IS_PROD = process.env.NODE_ENV === "production";

// Parse allowed origins
const rawOrigins = process.env.ALLOWED_ORIGINS ?? "*";
const allowedOrigins = rawOrigins === "*" ? "*" : rawOrigins.split(",").map((o) => o.trim());

const httpServer = createServer();

// Configure Socket.IO on standard path /socket.io
const io = new Server(httpServer, {
  path: "/socket.io",
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin;
  if (IS_PROD && allowedOrigins !== "*") {
    if (!origin || !allowedOrigins.includes(origin)) {
      return next(new Error("disallowed_origin"));
    }
  }
  next();
});

const socketIoListeners = httpServer.listeners("request");
httpServer.removeAllListeners("request");

httpServer.on("request", (req, res) => {
  let pathname = "";
  let isEngineTraffic = false;
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    pathname = url.pathname;
    isEngineTraffic =
      pathname.startsWith("/socket.io") ||
      url.searchParams.has("EIO") ||
      url.searchParams.has("transport");
  } catch {
    isEngineTraffic = false;
  }

  if (isEngineTraffic) {
    for (const listener of socketIoListeners) listener.call(httpServer, req, res);
    return;
  }

  handleRest(req, res, pathname);
});

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

const MAX_RATE_LIMIT_ENTRIES = 5000;
const publishRateMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  if (publishRateMap.size > MAX_RATE_LIMIT_ENTRIES) {
    for (const [key, val] of publishRateMap.entries()) {
      if (now > val.resetAt) publishRateMap.delete(key);
    }
  }
  const entry = publishRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    publishRateMap.set(ip, { count: 1, resetAt: now + 1000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 100;
}

function handleRest(req, res, pathname) {
  if (pathname === "/health" && req.method === "GET") {
    send(res, 200, {
      status: "ok",
      service: "interlock-realtime",
      clients: io.engine.clientsCount,
      uptime: process.uptime(),
    });
    return;
  }

  if (pathname === "/publish" && req.method === "POST") {
    const clientIp = req.socket.remoteAddress || "unknown";
    if (isRateLimited(clientIp)) {
      send(res, 429, { error: "rate_limited" });
      return;
    }

    const authHeader = req.headers["x-lab-token"];
    if (!verifyRealtimeToken(authHeader, TOKEN)) {
      send(res, 401, { error: "unauthorized" });
      return;
    }

    let bytesReceived = 0;
    let body = "";
    req.on("data", (chunk) => {
      bytesReceived += chunk.length;
      if (bytesReceived > MAX_PAYLOAD_BYTES) {
        req.destroy();
        send(res, 413, { error: "payload_too_large" });
        return;
      }
      body += chunk;
    });

    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const events = Array.isArray(parsed.events) ? parsed.events : [parsed];
        const validEvents = events.filter(isValidEvent);

        if (validEvents.length > 0) {
          io.emit("lab", { events: validEvents });
        }

        send(res, 200, { ok: true, broadcastCount: validEvents.length });
      } catch {
        send(res, 400, { error: "invalid_json" });
      }
    });
    return;
  }

  send(res, 404, { error: "not_found" });
}

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`Realtime bridge listening on 127.0.0.1:${PORT} (socket.io path "/socket.io" and "/")`);
});
