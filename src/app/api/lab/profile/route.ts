import { z } from "zod";
import { getEngine } from "@/server/lab/engine";
import { handleError } from "@/server/lab/api-utils";
import { assertAuthorized } from "@/server/lab/auth";

const Body = z.object({ replica: z.literal("B"), profile: z.string().min(1) });

/** POST /api/lab/profile — recreate Replica B with a selected profile (standby only). */
export async function POST(request: Request) {
  try {
    assertAuthorized(request, "profile");
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_request", message: "replica must be B and profile is required" },
        { status: 400 },
      );
    }
    getEngine().setProfile(parsed.data.replica, parsed.data.profile);
    return Response.json({ ok: true, applied: parsed.data.profile });
  } catch (err) {
    return handleError(err);
  }
}
