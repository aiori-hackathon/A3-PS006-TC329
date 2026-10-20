import { db } from "@/lib/db";
import { handleError } from "@/server/lab/api-utils";

/** GET /api/audit?runId=&limit= — persisted audit rows for a run (defaults to the most recent run). */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 300)));
    const recent = await db.auditEvent.findMany({
      distinct: ["runId"],
      orderBy: { id: "desc" },
      take: 12,
      select: { runId: true },
    });
    const runIds = recent.map((r) => r.runId);
    const runId = url.searchParams.get("runId") ?? runIds[0] ?? null;
    if (!runId) return Response.json({ events: [], runIds: [] });

    const rows = await db.auditEvent.findMany({
      where: { runId },
      orderBy: { seq: "asc" },
      take: limit,
    });
    return Response.json({
      runIds,
      events: rows.map((r) => ({
        seq: r.seq,
        ts: r.ts.toISOString(),
        runId: r.runId,
        event: r.event,
        replica: r.replica,
        decision: r.decision,
        reason: r.reason,
        policy: r.policy,
        prev: r.prev,
        hash: r.hash,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
