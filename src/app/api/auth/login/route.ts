import { NextResponse } from "next/server";
import { jsonError } from "@/server/lab/api-utils";
import { getAdminKey, safeCompare, createSessionCookie } from "@/server/lab/auth";
import { createSessionToken } from "@/server/lab/session";

export async function POST(request: Request) {
  let body: { key?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { key?: unknown; password?: unknown };
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON payload");
  }

  const providedKey = (body.key ?? body.password) as string | undefined;
  if (!providedKey || typeof providedKey !== "string") {
    return jsonError(400, "bad_request", "Missing administrative key or password");
  }

  const adminKey = getAdminKey();
  if (!adminKey) {
    return jsonError(403, "forbidden", "Authentication not configured on server");
  }

  if (!safeCompare(providedKey, adminKey)) {
    return jsonError(401, "unauthorized", "Invalid administrative key");
  }

  const sessionToken = createSessionToken();
  const cookieHeader = createSessionCookie(sessionToken);

  const response = NextResponse.json({ ok: true, user: "operator" });
  response.headers.set("set-cookie", cookieHeader);
  return response;
}
