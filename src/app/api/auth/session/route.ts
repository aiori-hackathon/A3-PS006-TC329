import { NextResponse } from "next/server";
import { verifyAdminAuth } from "@/server/lab/auth";

export async function GET(request: Request) {
  const isAuth = verifyAdminAuth(request);
  return NextResponse.json({
    authenticated: isAuth,
    user: isAuth ? "operator" : null,
  });
}
