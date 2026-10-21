import { timingSafeEqual } from "node:crypto";

export const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB payload limit
export const ALLOWED_EVENT_TYPES = new Set(["state", "audit", "probe", "health", "fault", "policy", "run"]);

/**
 * Constant-time comparison for realtime publish authentication tokens.
 */
export function verifyRealtimeToken(headerToken, expectedToken) {
  if (!headerToken || typeof headerToken !== "string") return false;
  try {
    const provided = Buffer.from(headerToken, "utf-8");
    const expected = Buffer.from(expectedToken, "utf-8");
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

/**
 * Validates that an incoming event object complies with the lab event schema.
 */
export function isValidEvent(ev) {
  if (!ev || typeof ev !== "object" || Array.isArray(ev)) return false;
  if (typeof ev.type !== "string" || !ALLOWED_EVENT_TYPES.has(ev.type)) return false;
  if (!("payload" in ev)) return false;
  if (typeof ev.ts !== "string") return false;
  return true;
}
