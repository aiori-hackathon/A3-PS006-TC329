import { z } from "zod";
import { getEngine } from "@/server/lab/engine";
import { handleError } from "@/server/lab/api-utils";
import { assertAuthorized } from "@/server/lab/auth";

const Body = z.object({
  replica: z.enum(["A", "B"]),
  fault: z.enum(["CRASH", "LINK_LOSS", "OVERLOAD"]),
  action: z.enum(["inject", "clear"]),
});

/** POST /api/lab/fault — inject or clear a fault on a replica (audit: fault_injected / fault_cleared). */
export async function POST(request: Request) {
  try {
    assertAuthorized(request, "fault");
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "invalid body" },
        { status: 400 },
      );
    }
    const { replica, fault, action } = parsed.data;
    const engine = getEngine();
    if (action === "inject") engine.injectFault(replica, fault);
    else engine.clearFault(replica);
    return Response.json({ ok: true, replica, fault, action });
  } catch (err) {
    return handleError(err);
  }
}
