import { z } from "zod";
import { getEngine } from "@/server/lab/engine";
import { handleError } from "@/server/lab/api-utils";

const Body = z.object({ yaml: z.string().min(1) });

/** POST /api/policy/validate — validation is data, never a 4xx (docs/06). */
export async function POST(request: Request) {
  try {
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ valid: false, error: "'yaml' is required" });
    }
    const result = getEngine().validatePolicyYaml(parsed.data.yaml);
    if (!result.valid) return Response.json({ valid: false, error: result.error });
    return Response.json({
      valid: true,
      sha: result.sha,
      parsed: {
        id: result.parsed.policyId,
        allowedLocations: result.parsed.allowedLocations,
        tlsMinVersion: result.parsed.tlsMinVersion,
        tlsEnforcement: result.parsed.tlsEnforcement,
        requireCertLabelMatch: result.parsed.requireCertLabelMatch,
        requireMinimalLogging: result.parsed.requireMinimalLogging,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
