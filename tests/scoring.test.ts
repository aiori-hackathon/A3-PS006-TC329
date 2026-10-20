import { describe, expect, test } from "bun:test";
import { scoreRun, type RunEvidence } from "../src/server/lab/scoring";

describe("Scoring Engine C1 through C6 Invariants & Calculations", () => {
  const basePassingEvidence: RunEvidence = {
    expect: "FAILOVER",
    outcome: "FAILOVER",
    reasonsExpected: [],
    reasonsActual: [],
    servedByNoncompliant: 0,
    chainOk: true,
    orderOk: true,
    downtimeMs: 50, // within 1500ms budget
    fault: "crash",
    refusalMs: null,
    failClosedSustained: false,
    determinismOk: true,
  };

  test("Perfect compliant failover achieves 100 points and A+ grade", () => {
    const score = scoreRun(basePassingEvidence);
    expect(score.total).toBe(100);
    expect(score.grade).toBe("A+");
    expect(score.components.find((c) => c.key === "C1")?.points).toBe(20);
    expect(score.components.find((c) => c.key === "C2")?.points).toBe(10);
    expect(score.components.find((c) => c.key === "C3")?.points).toBe(20);
    expect(score.components.find((c) => c.key === "C4")?.points).toBe(20);
    expect(score.components.find((c) => c.key === "C5")?.points).toBe(20);
    expect(score.components.find((c) => c.key === "C6")?.points).toBe(10);
  });

  test("Safety violation (servedByNoncompliant > 0) strictly clamps grade to D", () => {
    const violatedEvidence: RunEvidence = {
      ...basePassingEvidence,
      servedByNoncompliant: 1, // 1 request served by non-compliant replica!
    };
    const score = scoreRun(violatedEvidence);
    expect(score.components.find((c) => c.key === "C3")?.points).toBe(0);
    expect(score.grade).toBe("D"); // Even if total score was 80, grade is strictly D
  });

  test("Refusal run with fast refusal and sustained fail-closed achieves 100 points", () => {
    const refusalEvidence: RunEvidence = {
      expect: "REFUSED",
      outcome: "REFUSED",
      reasonsExpected: ["R5_TLS_BELOW_MIN"],
      reasonsActual: ["R5_TLS_BELOW_MIN"],
      servedByNoncompliant: 0,
      chainOk: true,
      orderOk: true,
      downtimeMs: null,
      fault: "crash",
      refusalMs: 120, // <= 2500ms fast refusal
      failClosedSustained: true,
      determinismOk: true,
    };
    const score = scoreRun(refusalEvidence);
    expect(score.total).toBe(100);
    expect(score.grade).toBe("A+");
    expect(score.components.find((c) => c.key === "C5")?.points).toBe(20);
  });

  test("Reason code mismatch fails C2", () => {
    const mismatchedReasons: RunEvidence = {
      ...basePassingEvidence,
      expect: "REFUSED",
      outcome: "REFUSED",
      reasonsExpected: ["R3_LOCATION_NOT_ALLOWED", "R5_TLS_BELOW_MIN"],
      reasonsActual: ["R5_TLS_BELOW_MIN"], // Missing R3!
    };
    const score = scoreRun(mismatchedReasons);
    expect(score.components.find((c) => c.key === "C2")?.points).toBe(0);
  });

  test("Failed determinism replay fails C6", () => {
    const replayFailedEvidence: RunEvidence = {
      ...basePassingEvidence,
      determinismOk: false,
    };
    const score = scoreRun(replayFailedEvidence);
    expect(score.components.find((c) => c.key === "C6")?.points).toBe(0);
    expect(score.total).toBe(90);
    expect(score.grade).toBe("A");
  });

  test("Broken audit chain drops 12 points from C4", () => {
    const brokenChainEvidence: RunEvidence = {
      ...basePassingEvidence,
      chainOk: false,
      orderOk: true,
    };
    const score = scoreRun(brokenChainEvidence);
    expect(score.components.find((c) => c.key === "C4")?.points).toBe(8); // order 8, chain 0
  });
});
