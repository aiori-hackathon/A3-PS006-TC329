import { db } from "@/lib/db";
import { summarize } from "@/server/lab/analyze";
import { handleError } from "@/server/lab/api-utils";
import { SCENARIOS } from "@/server/lab/runner";

const GRADE_ORDER = ["D", "C", "B", "A", "A+"];

function runPassedVerification(
  r: {
    status: string;
    outcome: string | null;
    reasons: string | null;
    servedByNoncompliant: number | null;
    auditChainOk: boolean | null;
    auditOrderOk: boolean | null;
    grade: string | null;
  },
  expectOutcome: string,
  expectReasons: readonly string[],
): boolean {
  if (r.status !== "COMPLETED") return false;
  if (r.outcome !== expectOutcome) return false;
  if ((r.servedByNoncompliant ?? 0) > 0) return false;
  if (r.grade === "D") return false;
  if (r.auditChainOk === false || r.auditOrderOk === false) return false;

  // Reason codes verification
  const actualReasons = r.reasons && r.reasons !== "-" ? r.reasons.split("+") : [];
  if (expectReasons.length === 0) {
    if (actualReasons.length > 0) return false;
  } else {
    if (actualReasons.length !== expectReasons.length) return false;
    if (!expectReasons.every((exp) => actualReasons.includes(exp))) return false;
  }

  return true;
}

/** GET /api/analytics/matrix — per-scenario aggregates over completed verified runs. */
export async function GET() {
  try {
    const allRuns = await db.run.findMany({
      orderBy: { startedAt: "asc" },
    });

    const completedRuns = allRuns.filter((r) => r.status === "COMPLETED");

    const scenarios = Object.values(SCENARIOS).map((spec) => {
      const rows = completedRuns.filter((r) => r.scenario === spec.key);
      const passed = rows.filter((r) =>
        runPassedVerification(r, spec.expect, spec.reasons),
      ).length;

      const grades = rows.map((r) => r.grade).filter((g): g is string => Boolean(g));
      const bestGrade =
        grades.length > 0 ? [...GRADE_ORDER].reverse().find((g) => grades.includes(g)) ?? null : null;

      return {
        key: spec.key,
        title: spec.title,
        fault: spec.fault.toLowerCase(),
        bProfile: spec.bProfile,
        expect: spec.expect,
        headline: spec.headline,
        runs: rows.length,
        passRate: rows.length > 0 ? passed / rows.length : null,
        downtime: summarize(rows.map((r) => r.downtimeMs)),
        meanDetectMs: avg(rows.map((r) => r.detectMs)),
        meanScore: avg(rows.map((r) => r.scoreTotal)),
        bestGrade,
        violations: rows.reduce((a, r) => a + (r.servedByNoncompliant ?? 0), 0),
      };
    });

    return Response.json({ scenarios });
  } catch (err) {
    return handleError(err);
  }
}

function avg(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
