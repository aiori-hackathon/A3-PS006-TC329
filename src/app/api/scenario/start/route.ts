import { z } from "zod";
import { getEngine } from "@/server/lab/engine";
import { handleError } from "@/server/lab/api-utils";
import { assertAuthorized } from "@/server/lab/auth";

const Body = z.object({
  scenario: z.enum(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"]),
  repeats: z.number().int().min(1).max(10).default(3),
});

/** POST /api/scenario/start — start a scenario batch in the background (409 if already running). */
export async function POST(request: Request) {
  try {
    assertAuthorized(request, "scenario_start");
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "invalid body" },
        { status: 400 },
      );
    }
    await getEngine().startScenario(parsed.data.scenario, parsed.data.repeats);
    return Response.json({ ok: true, scenario: parsed.data.scenario, repeats: parsed.data.repeats });
  } catch (err) {
    return handleError(err);
  }
}
