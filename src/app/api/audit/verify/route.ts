import { db, ensureDbReady } from "@/lib/db";
import { verifyChain } from "@/server/lab/audit";
import { getEngine } from "@/server/lab/engine";
import type { AuditRecord } from "@/server/lab/models";

/** GET /api/audit/verify?runId= — hash-chain verification of the audit rows. */
export async function GET(request: Request) {
  let targetRunId: string | null = null;
  try {
    await ensureDbReady();
    const url = new URL(request.url);
    const requestedRunId = url.searchParams.get("runId");

    let engineRunId: string | null = null;
    let engineRecords: readonly AuditRecord[] = [];
    try {
      const engine = getEngine();
      engineRunId = engine.currentRunId || null;
      engineRecords = engine.liveAuditRecords;
      if (requestedRunId) {
        await engine.flushAuditPersistence(requestedRunId).catch(() => {});
      }
    } catch (e) {
      console.warn("[verify] engine lookup notice:", e);
    }

    let recentRunId: string | null = null;
    try {
      const recent = await db.auditEvent.findMany({
        distinct: ["runId"],
        orderBy: { id: "desc" },
        take: 12,
        select: { runId: true },
      });
      recentRunId = recent[0]?.runId ?? null;
    } catch (e) {
      console.warn("[verify] recent auditEvent query notice:", e);
    }

    targetRunId = requestedRunId ?? recentRunId ?? engineRunId;
    if (!targetRunId) {
      return Response.json({ ok: true, problemLine: null, message: "no events", count: 0 });
    }

    let rows: Array<any> = [];
    try {
      rows = await db.auditEvent.findMany({ where: { runId: targetRunId }, orderBy: { seq: "asc" } });
    } catch (e) {
      console.warn("[verify] db.auditEvent query notice:", e);
    }

    let records: AuditRecord[] = [];
    if (rows.length > 0) {
      records = rows.map((r) => {
        const tsStr =
          r.ts instanceof Date
            ? r.ts.toISOString()
            : typeof r.ts === "string"
              ? r.ts
              : new Date(r.ts).toISOString();
        return {
          seq: r.seq,
          ts: tsStr,
          runId: r.runId,
          event: r.event as AuditRecord["event"],
          replica: r.replica as AuditRecord["replica"],
          decision: r.decision as AuditRecord["decision"],
          reason: r.reason,
          policy: r.policy,
          prev: r.prev,
          hash: r.hash,
        };
      });
    } else if (engineRecords.length > 0 && (!requestedRunId || engineRunId === requestedRunId)) {
      records = [...engineRecords];
    }

    if (records.length === 0) {
      return Response.json({ runId: targetRunId, ok: true, problemLine: null, message: "no events", count: 0 });
    }

    const result = verifyChain(records);
    return Response.json({ runId: targetRunId, ...result });
  } catch (err) {
    console.error("[verify] unexpected error during audit verification:", err);
    return Response.json(
      {
        runId: targetRunId,
        ok: false,
        problemLine: null,
        message: err instanceof Error ? err.message : "Verification error",
        count: 0,
      },
      { status: 200 },
    );
  }
}
