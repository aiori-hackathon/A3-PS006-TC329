import { getEngine } from "@/server/lab/engine";
import { handleError } from "@/server/lab/api-utils";
import { assertAuthorized } from "@/server/lab/auth";

/** POST /api/scenario/cancel — stop after the current repeat (always leaves a clean state). */
export function POST(request: Request) {
  try {
    assertAuthorized(request, "scenario_cancel");
    getEngine().cancelScenario();
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
