import { db } from "@/lib/db";
import { handleError } from "@/server/lab/api-utils";

/** GET /api/runs?limit=&scenario= — run history (newest first). */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 60)));
    const scenario = url.searchParams.get("scenario");
    const runs = await db.run.findMany({
      where: scenario ? { scenario } : undefined,
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    return Response.json({
      runs: runs.map((r) => ({
        id: r.id,
        scenario: r.scenario,
        repeat: r.repeat,
        fault: r.fault,
        bProfile: r.bProfile,
        expect: r.expect,
        outcome: r.outcome,
        reasons: r.reasons,
        downtimeMs: r.downtimeMs,
        outageOpen: r.outageOpen,
        detectMs: r.detectMs,
        decideMs: r.decideMs,
        switchMs: r.switchMs,
        servedByNoncompliant: r.servedByNoncompliant,
        auditChainOk: r.auditChainOk,
        auditOrderOk: r.auditOrderOk,
        scoreTotal: r.scoreTotal,
        grade: r.grade,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
