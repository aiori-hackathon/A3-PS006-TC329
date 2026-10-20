/**
 * Scoring engine — see docs/08-scoring-engine-spec.md.
 * Deterministic function of run evidence only. Safety violation caps the grade at D.
 */

export type FaultKey = "crash" | "linkloss" | "overload" | "restored";

export interface RunEvidence {
  expect: "FAILOVER" | "REFUSED" | "RESTORED";
  outcome: string | null;
  reasonsExpected: readonly string[];
  reasonsActual: readonly string[];
  servedByNoncompliant: number;
  chainOk: boolean;
  orderOk: boolean;
  downtimeMs: number | null;
  fault: FaultKey;
  refusalMs: number | null; // fault → failover_refused
  failClosedSustained: boolean; // outage stayed open through the window and leaked nothing
  determinismOk: boolean;
}

export interface ScoreComponentOut {
  key: "C1" | "C2" | "C3" | "C4" | "C5" | "C6";
  label: string;
  points: number;
  maxPoints: number;
  note: string;
}

export interface ScoreOut {
  total: number;
  grade: "A+" | "A" | "B" | "C" | "D";
  components: ScoreComponentOut[];
}

const DOWNTIME_BUDGET_MS: Record<FaultKey, number> = {
  crash: 1500,
  linkloss: 2500,
  overload: 4500,
  restored: 8000,
};

const round1 = (x: number) => Math.round(x * 10) / 10;

export function scoreRun(e: RunEvidence): ScoreOut {
  const sameSet =
    e.reasonsActual.length === e.reasonsExpected.length &&
    [...e.reasonsExpected].every((r) => e.reasonsActual.includes(r));

  // C1 — outcome correctness (20)
  const c1 = e.outcome === e.expect;
  // C2 — reason codes (10)
  const c2 = sameSet;
  // C3 — safety invariant (20)
  const c3 = e.servedByNoncompliant === 0;

  // C4 — audit integrity (20): chain 12 + order 8
  const c4chain = e.chainOk;
  const c4order = e.orderOk;

  // C5 — responsiveness (20)
  let c5points = 0;
  let c5note = "";
  if (e.expect === "FAILOVER" || e.expect === "RESTORED") {
    const budget = DOWNTIME_BUDGET_MS[e.expect === "RESTORED" ? "restored" : e.fault];
    const floor = 3 * budget;
    const d = e.downtimeMs;
    if (d === null) {
      c5points = 0;
      c5note = "no outage recorded";
    } else if (d <= budget) {
      c5points = 20;
      c5note = `downtime ${round1(d)} ms within budget ${budget} ms`;
    } else if (d >= floor) {
      c5points = 0;
      c5note = `downtime ${round1(d)} ms at/above floor ${floor} ms`;
    } else {
      c5points = round1(20 * ((floor - d) / (floor - budget)));
      c5note = `downtime ${round1(d)} ms between budget ${budget} and floor ${floor}`;
    }
  } else {
    // Refused runs: fast refusal (10) + sustained fail-closed (10)
    const r = e.refusalMs;
    const fast = r !== null && r <= 2500;
    let fastPts = 0;
    if (r !== null) {
      fastPts = r <= 2500 ? 10 : Math.max(0, 10 * ((5000 - r) / 2500));
    }
    const sustainedPts = e.failClosedSustained ? 10 : 0;
    const refusalText = r === null ? "never" : `${round1(r)} ms`;
    c5points = round1(fastPts + sustainedPts);
    c5note = `refusal ${refusalText} (${fast ? "fast" : "slow"}); ${
      e.failClosedSustained ? "fail-closed sustained" : "fail-closed not sustained"
    }`;
  }

  // C6 — determinism replay (10)
  const c6 = e.determinismOk;

  const components: ScoreComponentOut[] = [
    { key: "C1", label: "Outcome correctness", points: c1 ? 20 : 0, maxPoints: 20, note: c1 ? `outcome ${e.outcome} as expected` : `outcome ${e.outcome ?? "none"}, expected ${e.expect}` },
    { key: "C2", label: "Reason codes", points: c2 ? 10 : 0, maxPoints: 10, note: c2 ? "reason codes match the matrix" : `got ${e.reasonsActual.join("+") || "-"}, expected ${e.reasonsExpected.join("+") || "-"}` },
    { key: "C3", label: "Safety invariant", points: c3 ? 20 : 0, maxPoints: 20, note: `${e.servedByNoncompliant} request(s) served by a non-compliant replica` },
    { key: "C4", label: "Audit integrity", points: (c4chain ? 12 : 0) + (c4order ? 8 : 0), maxPoints: 20, note: `chain ${e.chainOk ? "OK" : "BROKEN"}; order ${e.orderOk ? "OK" : "INVALID"}` },
    { key: "C5", label: "Responsiveness", points: c5points, maxPoints: 20, note: c5note },
    { key: "C6", label: "Determinism replay", points: c6 ? 10 : 0, maxPoints: 10, note: c6 ? "replayed evaluation reproduced the decision" : "replay mismatch" },
  ];

  const total = round1(Math.max(0, Math.min(100, components.reduce((a, c) => a + c.points, 0))));
  let grade: ScoreOut["grade"] = "D";
  if (total >= 97) grade = "A+";
  else if (total >= 90) grade = "A";
  else if (total >= 80) grade = "B";
  else if (total >= 70) grade = "C";
  if (e.servedByNoncompliant > 0) grade = "D"; // safety outranks everything

  return { total, grade, components };
}
