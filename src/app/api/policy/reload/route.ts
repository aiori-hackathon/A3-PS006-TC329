import { z } from "zod";
import { getEngine } from "@/server/lab/engine";
import { handleError } from "@/server/lab/api-utils";
import { assertAuthorized } from "@/server/lab/auth";

const Body = z.object({ yaml: z.string().min(1) });

/** POST /api/policy/reload — an invalid reload keeps the previous policy (audited policy_load_failed). */
export async function POST(request: Request) {
  try {
    assertAuthorized(request, "policy_reload");
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ ok: false, error: "'yaml' is required" }, { status: 400 });
    }
    const result = await getEngine().reloadPolicy(parsed.data.yaml);
    return Response.json(result);
  } catch (err) {
    return handleError(err);
  }
}
