import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/server/lab/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true, message: "Logged out" });
  response.headers.set("set-cookie", clearSessionCookie());
  return response;
}
