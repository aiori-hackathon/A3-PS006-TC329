import { z } from "zod";
import { db } from "@/lib/db";
import { handleError } from "@/server/lab/api-utils";
import { getTampered, setTampered } from "@/server/lab/tamper";
import { assertAuthorized } from "@/server/lab/auth";

const Body = z.object({ runId: z.string().optional() });

/**
 * POST /api/audit/tamper — DEMO ONLY.
 * Rewrites the decision field of one persisted audit row (as an attacker would),
 * so the hash-chain verifier can be shown catching it. Exactly one row at a
 * time; restore with POST /api/audit/restore. Protected by admin auth.
 */
export async function POST(request: Request) {
  try {
    // Demonstration safety gate — must be explicitly enabled
    if (process.env.ALLOW_TAMPER_DEMO !== "true") {
      return Response.json(
        { error: "forbidden", message: "Tamper demonstration is disabled. Set ALLOW_TAMPER_DEMO=true to enable." },
        { status: 403 },
      );
    }
    assertAuthorized(request, "audit_tamper");
    if (getTampered()) {
      return Response.json(
        { error: "already_tampered", message: "A row is already rewritten. Restore it first." },
        { status: 409 },
      );
    }
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    const body = parsed.success ? parsed.data : {};

    let runId = body.runId;
    if (!runId) {
      const recent = await db.auditEvent.findMany({
        distinct: ["runId"],
        orderBy: { id: "desc" },
        take: 1,
        select: { runId: true },
      });
      runId = recent[0]?.runId;
    }
    if (!runId) {
      return Response.json(
        { error: "no_events", message: "No audit rows exist yet. Run a scenario first." },
        { status: 400 },
      );
    }

    const rows = await db.auditEvent.findMany({ where: { runId }, orderBy: { seq: "asc" } });
    if (rows.length === 0) {
      return Response.json(
        { error: "no_events", message: "This run has no audit rows." },
        { status: 400 },
      );
    }

    // Target the most narratively interesting decision record.
    const target =
      rows.find((r) => r.event === "policy_evaluated" && r.decision === "PASS") ??
      rows.find((r) => r.event === "failover_done" && r.decision === "SWITCHED") ??
      rows.find((r) => r.event === "policy_evaluated") ??
      rows.find((r) => r.event === "failover_done") ??
      rows[rows.length - 1];

    const to =
      target.decision === "PASS" ? "FAIL" : target.decision === "SWITCHED" ? "REFUSED" : "PASS";

    setTampered(target);
    await db.auditEvent.update({ where: { id: target.id }, data: { decision: to } });

    // problemLine == seq: the chain is 1-based contiguous per run.
    return Response.json({
      ok: true,
      runId,
      seq: target.seq,
      event: target.event,
      from: target.decision,
      to,
      line: target.seq,
    });
  } catch (err) {
    return handleError(err);
  }
}
