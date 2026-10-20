import { db } from "@/lib/db";
import { verifyChain } from "@/server/lab/audit";
import { handleError } from "@/server/lab/api-utils";
import type { AuditRecord } from "@/server/lab/models";

/** GET /api/audit/verify?runId= — hash-chain verification of the persisted audit rows. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const recent = await db.auditEvent.findMany({
      distinct: ["runId"],
      orderBy: { id: "desc" },
      take: 12,
      select: { runId: true },
    });
    const runId = url.searchParams.get("runId") ?? recent[0]?.runId ?? null;
    if (!runId) return Response.json({ ok: true, problemLine: null, message: "no events", count: 0 });

    const rows = await db.auditEvent.findMany({ where: { runId }, orderBy: { seq: "asc" } });
    const records: AuditRecord[] = rows.map((r) => ({
      seq: r.seq,
      ts: r.ts.toISOString(),
      runId: r.runId,
      event: r.event as AuditRecord["event"],
      replica: r.replica as AuditRecord["replica"],
      decision: r.decision as AuditRecord["decision"],
      reason: r.reason,
      policy: r.policy,
      prev: r.prev,
      hash: r.hash,
    }));
    const result = verifyChain(records);
    return Response.json({ runId, ...result });
  } catch (err) {
    return handleError(err);
  }
}
