/** Shared API helpers: typed error mapping and JSON responses (docs/06-api-contracts.md). */

import { NextResponse } from "next/server";
import { NoFaultError, ReplicaActiveError, RunLockedError } from "./engine";
import { PolicyError } from "./policy";
import { ForbiddenError, UnauthorizedError } from "./auth";

export function jsonOk<T>(data: T): NextResponse {
  return NextResponse.json(data);
}

export function jsonError(status: number, error: string, message: string): NextResponse {
  return NextResponse.json({ error, message }, { status });
}

/** Map engine/policy/auth errors to the contract's status codes. Unknown errors are sanitized to 500. */
export function handleError(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) return jsonError(401, "unauthorized", err.message);
  if (err instanceof ForbiddenError) return jsonError(403, "forbidden", err.message);
  if (err instanceof RunLockedError) return jsonError(409, "run_locked", err.message);
  if (err instanceof ReplicaActiveError) return jsonError(409, "replica_active", err.message);
  if (err instanceof NoFaultError) return jsonError(400, "no_fault", err.message);
  if (err instanceof PolicyError) return jsonError(400, "invalid_request", err.message);

  // Log internal error with stack trace server-side only
  console.error("[interlock-api-error]", err);

  // Return sanitized generic message without leaking internals
  return jsonError(500, "internal_error", "An internal error occurred while processing the request.");
}
