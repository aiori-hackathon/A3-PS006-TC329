import { z } from "zod";
import { getEngine } from "@/server/lab/engine";
import { handleError } from "@/server/lab/api-utils";
import { assertAuthorized } from "@/server/lab/auth";

const Body = z.object({ to: z.enum(["A", "B"]) });

/** POST /api/lab/switch — manual switch request; passes the same policy gate.
 *  A refusal is an expected outcome (200 with result REFUSED), never an error. */
export async function POST(request: Request) {
  try {
    assertAuthorized(request, "switch");
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "invalid_request", message: "'to' must be A or B" }, { status: 400 });
    }
    const result = await getEngine().manualSwitch(parsed.data.to);
    return Response.json(result);
  } catch (err) {
    return handleError(err);
  }
}
