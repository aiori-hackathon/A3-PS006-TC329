import { getEngine } from "@/server/lab/engine";
import { handleError } from "@/server/lab/api-utils";

/** GET /api/scenario/status — live batch progress or the last completed batch. */
export function GET() {
  try {
    return Response.json({ status: getEngine().scenarioRunStatus });
  } catch (err) {
    return handleError(err);
  }
}
