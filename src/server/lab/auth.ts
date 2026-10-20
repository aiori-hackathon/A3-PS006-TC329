/**
 * Authentication & Authorization for INTERLOCK control room mutation APIs.
 * Enforces admin authorization on all state-changing endpoints.
 */

import { timingSafeEqual } from "crypto";
import {
  createSessionToken,
  verifySessionToken,
  safeDecodeURIComponent,
  validateCsrfOrigin,
} from "./session";

export class UnauthorizedError extends Error {
  readonly code = "unauthorized" as const;
  constructor(message = "Authentication required for this operation") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly code = "forbidden" as const;
  constructor(message = "Forbidden: Insufficient privileges for this operation") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export const DEFAULT_DEV_KEY = "interlock-admin-secret";
const IS_PROD = process.env.NODE_ENV === "production";

/**
 * Retrieves the configured administrative key.
 * In production mode, returns null if missing or set to the default dev key,
 * forcing a fail-closed posture unless demo mode is explicitly enabled.
 */
export function getAdminKey(): string | null {
  const configured = process.env.ADMIN_API_KEY;
  if (configured && configured.length > 0) {
    if (IS_PROD && configured === DEFAULT_DEV_KEY && process.env.ALLOW_INSECURE_DEMO_MODE !== "true") {
      console.error("[security] FATAL: ADMIN_API_KEY must not use default dev secret in production mode.");
      return null;
    }
    return configured;
  }
  if (IS_PROD && process.env.ALLOW_INSECURE_DEMO_MODE !== "true") {
    console.error("[security] FATAL: ADMIN_API_KEY must be configured in production mode.");
    return null;
  }
  return DEFAULT_DEV_KEY;
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
export function safeCompare(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided, "utf-8");
    const b = Buffer.from(expected, "utf-8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Checks request headers or cookies for valid operator credentials.
 */
export function verifyAdminAuth(request: Request): boolean {
  const expectedKey = getAdminKey();

  // 1. Check x-admin-key header (for CLI, test runners, automation)
  const headerKey = request.headers.get("x-admin-key");
  if (headerKey && expectedKey && safeCompare(headerKey, expectedKey)) {
    return true;
  }

  // 2. Check Authorization: Bearer <key>
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ") && expectedKey) {
    const token = authHeader.slice(7).trim();
    if (safeCompare(token, expectedKey)) {
      return true;
    }
  }

  // 3. Check interlock_session cookie
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith("interlock_session=")) {
        const raw = cookie.slice("interlock_session=".length);
        const sessionToken = safeDecodeURIComponent(raw);
        if (!sessionToken) continue;

        // Check if it is a cryptographically signed session token
        const session = verifySessionToken(sessionToken);
        if (session) {
          // If authenticated via cookie on state-changing method, validate CSRF origin
          if (!validateCsrfOrigin(request)) {
            return false;
          }
          return true;
        }

        // Direct key comparison for backward compatibility with existing tests
        if (expectedKey && safeCompare(sessionToken, expectedKey)) {
          if (!validateCsrfOrigin(request)) {
            return false;
          }
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Asserts that the request carries valid admin authorization.
 * Throws UnauthorizedError or ForbiddenError if missing or invalid.
 */
export function assertAuthorized(request: Request, _action = "mutation"): void {
  const expectedKey = getAdminKey();
  if (!expectedKey) {
    throw new ForbiddenError("Server administrative authentication is not configured. Failing closed.");
  }

  if (!verifyAdminAuth(request)) {
    throw new UnauthorizedError("Valid operator authorization (session cookie, x-admin-key, or Bearer token) is required.");
  }
}

/**
 * Generates an HttpOnly, Secure, SameSite=Strict cookie header string for session token.
 */
export function createSessionCookie(token: string): string {
  const secureFlag = IS_PROD ? "; Secure" : "";
  return `interlock_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secureFlag}`;
}

/**
 * Generates an expired cookie header string to log out the operator.
 */
export function clearSessionCookie(): string {
  const secureFlag = IS_PROD ? "; Secure" : "";
  return `interlock_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`;
}

export { createSessionToken, verifySessionToken };
