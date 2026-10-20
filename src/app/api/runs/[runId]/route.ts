import { db } from "@/lib/db";
import { handleError } from "@/server/lab/api-utils";

function downsample<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows;
  const step = rows.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(rows[Math.floor(i * step)]);
  out[out.length - 1] = rows[rows.length - 1];
  return out;
}

/** GET /api/runs/{runId} — full run evidence: timeline, probe, score breakdown, audit rows. */
export async function GET(_request: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const run = await db.run.findUnique({ where: { id: runId } });
    if (!run) {
      return Response.json({ error: "not_found", message: `no run ${runId}` }, { status: 404 });
    }
    const [components, auditRows, probeRows] = await Promise.all([
      db.scoreComponent.findMany({ where: { runId }, orderBy: { key: "asc" } }),
      db.auditEvent.findMany({ where: { runId }, orderBy: { seq: "asc" } }),
      db.probeRecord.findMany({ where: { runId }, orderBy: { seq: "asc" } }),
    ]);

    const faultIso = run.tFaultIso?.getTime() ?? run.startedAt.getTime();
    const timeline = auditRows.map((r) => ({
      tsIso: r.ts.toISOString(),
      offsetMs: r.ts.getTime() - faultIso,
      event: r.event,
      replica: r.replica,
      decision: r.decision,
      reason: r.reason,
    }));

    return Response.json({
      run: {
        id: run.id,
        scenario: run.scenario,
        repeat: run.repeat,
        fault: run.fault,
        bProfile: run.bProfile,
        expect: run.expect,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        endedAt: run.endedAt?.toISOString() ?? null,
        tFaultIso: run.tFaultIso?.toISOString() ?? null,
        tDetectIso: run.tDetectIso?.toISOString() ?? null,
        tDecisionIso: run.tDecisionIso?.toISOString() ?? null,
        tSwitchIso: run.tSwitchIso?.toISOString() ?? null,
        detectMs: run.detectMs,
        decideMs: run.decideMs,
        switchMs: run.switchMs,
        outcome: run.outcome,
        reasons: run.reasons,
        downtimeMs: run.downtimeMs,
        outageOpen: run.outageOpen,
        servedByNoncompliant: run.servedByNoncompliant,
        auditChainOk: run.auditChainOk,
        auditOrderOk: run.auditOrderOk,
        scoreTotal: run.scoreTotal,
        grade: run.grade,
        observation: safeParse(run.observationJson),
      },
      score: {
        total: run.scoreTotal ?? 0,
        grade: run.grade ?? "D",
        components: components.map((c) => ({
          key: c.key,
          label: c.label,
          points: c.points,
          maxPoints: c.maxPoints,
          note: c.note,
        })),
      },
      timeline,
      probe: downsample(
        probeRows.map((p) => ({
          seq: p.seq,
          tSendNs: p.tSend.getTime() * 1e6,
          ok: p.ok,
          status: p.status ?? null,
          latencyMs: p.latencyMs ?? null,
          servedBy: p.servedBy ?? null,
          epoch: p.epoch ?? null,
          error: p.error ?? null,
        })),
        600,
      ),
      audit: auditRows.map((r) => ({
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

function safeParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
