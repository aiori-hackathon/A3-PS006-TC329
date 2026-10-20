import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const DEFAULT_SESSION_SECRET = "interlock-session-dev-signing-key";
const IS_PROD = process.env.NODE_ENV === "production";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SessionData {
  sessionId: string;
  user: "operator";
  issuedAt: number;
  expiresAt: number;
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_API_KEY;
  if (secret && secret.length > 0) return secret;
  if (IS_PROD && process.env.ALLOW_INSECURE_DEMO_MODE !== "true") {
    throw new Error("[security] FATAL: SESSION_SECRET or ADMIN_API_KEY must be configured in production.");
  }
  return DEFAULT_SESSION_SECRET;
}

/**
 * Signs a payload with server-side HMAC-SHA-256.
 */
function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data, "utf-8").digest("hex");
}

/**
 * Creates a signed session token.
 */
export function createSessionToken(): string {
  const secret = getSessionSecret();
  const sessionId = randomBytes(16).toString("hex");
  const now = Date.now();
  const payload = `${sessionId}.${now}.${now + SESSION_TTL_MS}`;
  const signature = sign(payload, secret);
  return `${payload}.${signature}`;
}

/**
 * Verifies and parses a signed session token.
 * Returns null if the token is invalid, expired, or tampered.
 */
export function verifySessionToken(token: string): SessionData | null {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [sessionId, issuedAtStr, expiresAtStr, signature] = parts;
  const issuedAt = parseInt(issuedAtStr, 10);
  const expiresAt = parseInt(expiresAtStr, 10);

  if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt)) return null;
  if (Date.now() > expiresAt) return null; // Expired

  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return null;
  }

  const payload = `${sessionId}.${issuedAtStr}.${expiresAtStr}`;
  const expectedSignature = sign(payload, secret);

  const sigBuf = Buffer.from(signature, "utf-8");
  const expectedBuf = Buffer.from(expectedSignature, "utf-8");

  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  return {
    sessionId,
    user: "operator",
    issuedAt,
    expiresAt,
  };
}

/**
 * Safely decodes percent-encoded cookie strings without throwing on malformed inputs.
 */
export function safeDecodeURIComponent(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/**
 * Validates request Origin/Referer against the Host header to prevent CSRF on cookie-authenticated mutations.
 */
export function validateCsrfOrigin(request: Request): boolean {
  // Safe methods don't require CSRF origin validation
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return true;
  }

  const host = request.headers.get("host") || request.headers.get("x-forwarded-host");
  const origin = request.headers.get("origin");

  // If Origin header is present, check host match
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) return true;
    } catch {
      return false;
    }
    return false;
  }

  // Fallback to Referer
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refUrl = new URL(referer);
      if (refUrl.host === host) return true;
    } catch {
      return false;
    }
    return false;
  }

  // If neither origin nor referer is present (e.g. CLI curl or non-browser), allow if it carries an explicit API key
  const hasApiKey = request.headers.has("x-admin-key") || request.headers.has("authorization");
  return hasApiKey;
}
