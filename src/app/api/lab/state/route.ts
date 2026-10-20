import { getEngine } from "@/server/lab/engine";
import { handleError } from "@/server/lab/api-utils";

/** GET /api/lab/state — full snapshot; drives the console and the polling fallback. */
export function GET() {
  try {
    return Response.json(getEngine().snapshot());
  } catch (err) {
    return handleError(err);
  }
}
