import { db } from "@/lib/db";
import { handleError } from "@/server/lab/api-utils";
import { clearTampered, getTampered } from "@/server/lab/tamper";
import { assertAuthorized } from "@/server/lab/auth";

/**
 * POST /api/audit/restore — undo the demo tamper by writing the original
 * row back, so the chain verifies green again. Protected by admin auth.
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
    assertAuthorized(request, "audit_restore");
    const original = getTampered();
    if (!original) {
      return Response.json(
        { error: "nothing_to_restore", message: "No rewritten row in this session." },
        { status: 404 },
      );
    }
    await db.auditEvent.update({
      where: { id: original.id },
      data: {
        seq: original.seq,
        ts: original.ts,
        event: original.event,
        replica: original.replica,
        decision: original.decision,
        reason: original.reason,
        policy: original.policy,
        prev: original.prev,
        hash: original.hash,
      },
    });
    clearTampered();
    return Response.json({ ok: true, runId: original.runId, seq: original.seq });
  } catch (err) {
    return handleError(err);
  }
}
