import { db } from "@/lib/db";
import { getEngine } from "@/server/lab/engine";
import { handleError } from "@/server/lab/api-utils";

/** GET /api/policy — current YAML, parsed summary, hash and load history. */
export async function GET() {
  try {
    const engine = getEngine();
    const snap = engine.snapshot();
    const history = await db.policyFile.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { sha: true, createdAt: true, active: true },
    });
    return Response.json({
      yaml: engine.currentPolicyYaml(),
      parsed: {
        id: snap.policy.id,
        sha: snap.policy.sha,
        minVersion: snap.policy.minVersion,
        enforcement: snap.policy.enforcement,
        allowedLocations: snap.policy.allowedLocations,
        requireCertLabelMatch: snap.policy.requireCertLabelMatch,
        requireMinimalLogging: snap.policy.requireMinimalLogging,
      },
      history: history.map((h) => ({ sha: h.sha, atIso: h.createdAt.toISOString(), active: h.active })),
    });
  } catch (err) {
    return handleError(err);
  }
}
