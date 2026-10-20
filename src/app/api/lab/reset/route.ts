import { getEngine } from "@/server/lab/engine";
import { handleError } from "@/server/lab/api-utils";
import { assertAuthorized } from "@/server/lab/auth";

/** POST /api/lab/reset — start a fresh live run (new audit chain, faults cleared, A active, epoch 0). */
export async function POST(request: Request) {
  try {
    assertAuthorized(request, "reset");
    const runId = await getEngine().resetLiveRun();
    return Response.json({ ok: true, runId });
  } catch (err) {
    return handleError(err);
  }
}
