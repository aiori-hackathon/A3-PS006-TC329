/**
 * Scenario runner — S1…S9 batch sequencer (PS-006 PRD §9 matrix).
 * Per repeat: reset → warmup 3 s → fault on A → observe 12 s (S9 restores A at +6 s)
 * → cleanup → analyze → score → persist → broadcast. Cancellation is checked between
 * phases and inside long waits (chunked sleeps), and always leaves a clean state.
 */

import type { AuditRecord } from "./audit";
import { verifyChain } from "./audit";
import { findOutages, primaryOutage, type Outage } from "./analyze";
import type { ProbeResult } from "./models";
import { evaluate, type Policy } from "./policy";
import { scoreRun, type RunEvidence, type ScoreOut } from "./scoring";
import { sleep } from "./replicas";
import type { GateLogEntry } from "./engine";

export type { RunEvidence, ScoreOut };

export interface ScenarioSpec {
  key: string;
  title: string;
  fault: "CRASH" | "LINK_LOSS" | "OVERLOAD";
  bProfile: string;
  expect: "FAILOVER" | "REFUSED" | "RESTORED";
  reasons: readonly string[];
  headline: boolean; // part of the demo set
  restore?: boolean; // S9: clear the crash mid-window to prove recovery
}

export const SCENARIOS: Record<string, ScenarioSpec> = {
  S1: { key: "S1", title: "Crash of A, B compliant", fault: "CRASH", bProfile: "compliant", expect: "FAILOVER", reasons: [], headline: true },
  S2: { key: "S2", title: "Link loss to A, B compliant", fault: "LINK_LOSS", bProfile: "compliant", expect: "FAILOVER", reasons: [], headline: true },
  S3: { key: "S3", title: "Overload of A, B EU + TLS 1.1", fault: "OVERLOAD", bProfile: "eu_weak_tls", expect: "REFUSED", reasons: ["R3_LOCATION_NOT_ALLOWED", "R5_TLS_BELOW_MIN"], headline: true },
  S4: { key: "S4", title: "Crash of A, B TLS 1.1", fault: "CRASH", bProfile: "weak_tls", expect: "REFUSED", reasons: ["R5_TLS_BELOW_MIN"], headline: true },
  S5: { key: "S5", title: "Link loss to A, B wrong location", fault: "LINK_LOSS", bProfile: "wrong_location", expect: "REFUSED", reasons: ["R3_LOCATION_NOT_ALLOWED"], headline: false },
  S6: { key: "S6", title: "Overload of A, B compliant", fault: "OVERLOAD", bProfile: "compliant", expect: "FAILOVER", reasons: [], headline: false },
  S7: { key: "S7", title: "Crash of A, B label mismatch", fault: "CRASH", bProfile: "label_mismatch", expect: "REFUSED", reasons: ["R4_LABEL_CERT_MISMATCH"], headline: false },
  S8: { key: "S8", title: "Crash of A, B verbose logging", fault: "CRASH", bProfile: "verbose_logging", expect: "REFUSED", reasons: ["R6_LOGGING_NOT_MINIMAL"], headline: false },
  S9: { key: "S9", title: "Crash of A, B refused, A restored", fault: "CRASH", bProfile: "weak_tls", expect: "RESTORED", reasons: ["R5_TLS_BELOW_MIN"], headline: false, restore: true },
};

export type ScenarioPhase =
  | "RESET" | "WARMUP" | "FAULT" | "OBSERVE" | "RECOVERY" | "CLEANUP"
  | "ANALYZE" | "SCORE" | "DONE";

export interface ScenarioRunStatus {
  running: boolean;
  scenario: string | null;
  repeat: number;
  repeats: number;
  phase: ScenarioPhase | null;
  phaseStartedIso: string | null;
  runId: string | null;
  batchId: string | null;
  progress: number; // 0..1
  cancelled?: boolean;
  lastSummary: RunSummary | null;
}

export interface RunSummary {
  runId: string;
  scenario: string;
  repeat: number;
  bProfile: string;
  outcome: string;
  reasons: string;
  downtimeMs: number | null;
  outageOpen: boolean | null;
  detectMs: number | null;
  decideMs: number | null;
  switchMs: number | null;
  servedByNoncompliant: number;
  auditChainOk: boolean;
  auditOrderOk: boolean;
  scoreTotal: number;
  grade: string;
  passedExpectation: boolean;
  status?: string;
  failedRequests?: number;
}

/** The narrow surface of the engine the runner needs (implemented by LabEngine). */
export interface ScenarioHost {
  readonly timings: { warmupMs: number; observeMs: number; restoreAtMs: number; settleMs: number; probeIntervalMs: number };
  cancelled: boolean;
  beginScenarioRun(runId: string, bProfile: string): Promise<void>;
  injectFaultInternal(replica: "A" | "B", fault: "CRASH" | "LINK_LOSS" | "OVERLOAD"): void;
  clearFaultInternal(replica: "A" | "B"): void;
  clearAllFaultsInternal(): void;
  endScenarioCapture(): { audit: readonly AuditRecord[]; probe: readonly ProbeResult[] };
  flushAuditPersistence(runId?: string): Promise<void>;
  getPersistedAudit(runId: string): Promise<readonly AuditRecord[]>;
  lastGateEvidence(replicaId: "A" | "B"): GateLogEntry | null;
  determinismOk(): boolean;
  servedByNoncompliantRun: number;
  setScenarioStatus(status: ScenarioRunStatus): void;
  persistRun(args: {
    summary: RunSummary;
    spec: ScenarioSpec;
    batchId: string;
    evidence: BuiltEvidence;
    score: ScoreOut;
    audit: readonly AuditRecord[];
    probe: readonly ProbeResult[];
    tFaultIso: string;
    tRunStartIso?: string;
    observationJson: string;
  }): Promise<void>;
  endBatch(): void;
  publishRun(status: ScenarioRunStatus): void;
  log(message: string): void;
}

export interface BuiltEvidence extends RunEvidence {
  outcome: string | null;
  reasonsMatch: boolean;
  outageOpen: boolean | null;
  detectMs: number | null;
  decideMs: number | null;
  switchMs: number | null;
  tDetectIso: string | null;
  tDecisionIso: string | null;
  tSwitchIso: string | null;
  observationJson: string;
  failedRequests: number;
}

const PHASE_WEIGHT: Record<ScenarioPhase, number> = {
  RESET: 0.0,
  WARMUP: 0.15,
  FAULT: 0.25,
  OBSERVE: 0.8,
  RECOVERY: 0.8,
  CLEANUP: 0.88,
  ANALYZE: 0.94,
  SCORE: 0.98,
  DONE: 1,
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

export async function runScenarioBatch(
  host: ScenarioHost,
  scenarioKey: string,
  repeats: number,
): Promise<void> {
  const spec = SCENARIOS[scenarioKey];
  const batchId = `b-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
  host.cancelled = false;
  const summaries: RunSummary[] = [];

  for (let r = 1; r <= repeats; r++) {
    if (host.cancelled) {
      host.log(`scenario batch ${scenarioKey} cancelled before repeat ${r}`);
      break;
    }
    try {
      const summary = await runOnce(host, spec, r, repeats, batchId);
      summaries.push(summary);
    } catch (err) {
      host.log(`scenario ${scenarioKey} repeat ${r} failed/cancelled: ${(err as Error).message}`);
      host.clearAllFaultsInternal();
      if (host.cancelled) break;
    }
  }

  // Fresh live run so manual play after a batch never pollutes the runs' evidence.
  host.endBatch();

  host.setScenarioStatus({
    running: false,
    scenario: scenarioKey,
    repeat: 0,
    repeats,
    phase: host.cancelled ? "CLEANUP" : "DONE",
    phaseStartedIso: new Date().toISOString(),
    runId: null,
    batchId,
    progress: 1,
    cancelled: host.cancelled,
    lastSummary: summaries[summaries.length - 1] ?? null,
  });
  host.publishRun({
    running: false,
    scenario: scenarioKey,
    repeat: 0,
    repeats,
    phase: host.cancelled ? "CLEANUP" : "DONE",
    phaseStartedIso: new Date().toISOString(),
    runId: null,
    batchId,
    progress: 1,
    cancelled: host.cancelled,
    lastSummary: summaries[summaries.length - 1] ?? null,
  });
}

async function runOnce(
  host: ScenarioHost,
  spec: ScenarioSpec,
  repeat: number,
  repeats: number,
  batchId: string,
): Promise<RunSummary> {
  const tRunStartIso = new Date().toISOString();
  const runId = `${spec.key.toLowerCase()}-r${pad2(repeat)}-${Date.now().toString(36)}`;
  let lastSummary: RunSummary | null = null;

  const phase = async (p: ScenarioPhase) => {
    const status: ScenarioRunStatus = {
      running: true,
      scenario: spec.key,
      repeat,
      repeats,
      phase: p,
      phaseStartedIso: new Date().toISOString(),
      runId,
      batchId,
      progress: (repeat - 1 + PHASE_WEIGHT[p]) / repeats,
      lastSummary,
    };
    host.setScenarioStatus(status);
    host.publishRun(status);
  };

  try {
    // RESET — fresh engine state, B recreated with the scenario profile, audit + capture on
    await phase("RESET");
    await host.beginScenarioRun(runId, spec.bProfile);
    if (host.cancelled) throw new Error("cancelled");

    // WARMUP
    await phase("WARMUP");
    await cancellableSleep(host, host.timings.warmupMs);
    if (host.cancelled) throw new Error("cancelled");

    // FAULT
    await phase("FAULT");
    const tFaultIso = new Date().toISOString();
    host.injectFaultInternal("A", spec.fault);

    // OBSERVE — S9 restores A inside the window so the probe records the recovery
    await phase(spec.restore ? "RECOVERY" : "OBSERVE");
    if (spec.restore) {
      let restored = false;
      const chunkMs = 100;
      for (let t = 0; t < host.timings.observeMs && !host.cancelled; t += chunkMs) {
        await sleep(Math.min(chunkMs, host.timings.observeMs - t));
        if (!restored && t >= host.timings.restoreAtMs) {
          restored = true;
          host.clearFaultInternal("A"); // restart replica A while B stays refused
        }
      }
    } else {
      await cancellableSleep(host, host.timings.observeMs);
    }
    if (host.cancelled) throw new Error("cancelled");

    // CLEANUP — probe capture stops here; the analysis window is [fault, now]
    await phase("CLEANUP");
    const windowEndIso = new Date().toISOString();
    const { audit, probe } = host.endScenarioCapture();
    host.clearAllFaultsInternal();
    await sleep(host.timings.settleMs);

    // ANALYZE
    await phase("ANALYZE");
    const evidence = await buildEvidence(host, spec, audit, probe, windowEndIso, runId);

    // SCORE
    await phase("SCORE");
    const score = scoreRun(evidence);
    const summary: RunSummary = {
      runId,
      scenario: spec.key,
      repeat,
      bProfile: spec.bProfile,
      outcome: evidence.outcome ?? "NONE",
      reasons: evidence.reasonsActual.join("+") || "-",
      downtimeMs: evidence.downtimeMs,
      outageOpen: evidence.outageOpen,
      detectMs: evidence.detectMs,
      decideMs: evidence.decideMs,
      switchMs: evidence.switchMs,
      servedByNoncompliant: evidence.servedByNoncompliant,
      auditChainOk: evidence.chainOk,
      auditOrderOk: evidence.orderOk,
      scoreTotal: score.total,
      grade: score.grade,
      passedExpectation:
        evidence.outcome === spec.expect &&
        evidence.reasonsMatch &&
        evidence.servedByNoncompliant === 0 &&
        evidence.chainOk &&
        evidence.orderOk,
      failedRequests: evidence.failedRequests,
      status: "COMPLETED",
    };
    lastSummary = summary;

    await host.persistRun({
      summary,
      spec,
      batchId,
      evidence,
      score,
      audit,
      probe,
      tFaultIso,
      tRunStartIso,
      observationJson: evidence.observationJson,
    });

    await phase("DONE");
    return summary;
  } finally {
    host.clearAllFaultsInternal();
  }
}

async function cancellableSleep(host: ScenarioHost, ms: number): Promise<void> {
  const chunk = 100;
  for (let t = 0; t < ms; t += chunk) {
    if (host.cancelled) return;
    await sleep(Math.min(chunk, ms - t));
  }
}

async function buildEvidence(
  host: ScenarioHost,
  spec: ScenarioSpec,
  inMemoryAudit: readonly AuditRecord[],
  probe: readonly ProbeResult[],
  windowEndIso: string,
  runId: string,
): Promise<BuiltEvidence> {
  // Await audit persistence to SQLite to verify the actual persisted chain
  let persistenceFailed = false;
  try {
    await host.flushAuditPersistence(runId);
  } catch (err) {
    persistenceFailed = true;
    host.log(`flushAuditPersistence error: ${(err as Error).message}`);
  }

  const dbRows = await host.getPersistedAudit(runId);
  const rows = dbRows.length > 0 ? dbRows : inMemoryAudit.filter((r) => r.ts <= windowEndIso);

  const faultRow = rows.find((r) => r.event === "fault_injected");
  const faultNs = faultRow ? Date.parse(faultRow.ts) * 1e6 : Number(process.hrtime.bigint());

  // Rows are in seq order; index-based lookups are exact
  const detectIdx = rows.findIndex((r) => r.event === "failure_detected");
  const decisionIdx = rows.findIndex((r, i) => r.event === "policy_evaluated" && i > detectIdx);
  const switchIdx = rows.findIndex(
    (r, i) =>
      (r.event === "failover_done" || r.event === "failover_refused" || r.event === "service_restored") &&
      i > decisionIdx,
  );
  const detectRow = detectIdx >= 0 ? rows[detectIdx] : null;
  const decisionRow = decisionIdx >= 0 ? rows[decisionIdx] : null;
  const switchRow = switchIdx >= 0 ? rows[switchIdx] : null;
  const refusedRow = rows.find((r) => r.event === "failover_refused") ?? null;
  const restoredRow = rows.find((r) => r.event === "service_restored") ?? null;

  const outcome = rows.some((r) => r.event === "failover_done")
    ? "FAILOVER"
    : restoredRow
      ? "RESTORED"
      : refusedRow
        ? "REFUSED"
        : "NONE";

  const reasonsActual = refusedRow && refusedRow.reason !== "-" ? refusedRow.reason.split("+") : [];
  const reasonsMatch =
    reasonsActual.length === spec.reasons.length && spec.reasons.every((r) => reasonsActual.includes(r));

  const outage: Outage | null = primaryOutage(findOutages(probe), faultNs, host.timings.probeIntervalMs);
  const failedRequests = outage ? outage.failedRequests : probe.filter((p) => !p.ok).length;

  const dt = (aIso: string | null, bIso: string | null): number | null =>
    aIso && bIso ? Date.parse(bIso) - Date.parse(aIso) : null;

  // C4 Persisted Audit Integrity
  const chainVerify = verifyChain(dbRows.length > 0 ? dbRows : rows);
  const chainOk = !persistenceFailed && chainVerify.ok && dbRows.length > 0;
  const orderOk = orderValid(rows);

  // C6 Reconstructed Determinism Replay from serialized evidence
  const candidateId = spec.expect === "FAILOVER" || spec.expect === "REFUSED" ? "B" : "A";
  const gateEvidence = host.lastGateEvidence(candidateId);
  let determinismOk = false;
  let observationJson = "{}";

  if (gateEvidence && gateEvidence.policy && gateEvidence.observation) {
    const serialized = {
      policy: gateEvidence.policy,
      observation: gateEvidence.observation,
      decision: gateEvidence.decision,
      candidate: candidateId,
      ts: new Date().toISOString(),
    };
    observationJson = JSON.stringify(serialized);

    try {
      let allReplaysMatch = true;
      for (let i = 0; i < 3; i++) {
        const reconstructed = JSON.parse(observationJson) as { policy: Policy; observation: any };
        const replayed = evaluate(reconstructed.policy, reconstructed.observation);
        if (
          replayed.passed !== gateEvidence.decision.passed ||
          replayed.reasons.join("+") !== gateEvidence.decision.reasons.join("+")
        ) {
          allReplaysMatch = false;
          break;
        }
      }
      determinismOk = allReplaysMatch;
    } catch {
      determinismOk = false;
    }
  }

  // Fail-closed verification
  let failClosedSustained = false;
  if (outcome === "REFUSED" && outage !== null && outage.open && host.servedByNoncompliantRun === 0) {
    const refusalProbes = probe.filter((p) => p.tSendNs >= faultNs);
    const anyLeaked = refusalProbes.some((p) => p.ok || p.servedBy === "B");
    const hadRefusalResponses = refusalProbes.some((p) => p.status === 503);
    failClosedSustained = !anyLeaked && hadRefusalResponses;
  }

  return {
    expect: spec.expect,
    outcome,
    reasonsExpected: spec.reasons,
    reasonsActual,
    reasonsMatch,
    servedByNoncompliant: host.servedByNoncompliantRun,
    chainOk,
    orderOk,
    downtimeMs: outage ? outage.downtimeMs : null,
    outageOpen: outage ? outage.open : null,
    failedRequests,
    fault: spec.restore ? "restored" : faultKeyOf(spec.fault),
    refusalMs: refusedRow && faultRow ? Date.parse(refusedRow.ts) - Date.parse(faultRow.ts) : null,
    failClosedSustained,
    determinismOk,
    detectMs: dt(faultRow?.ts ?? null, detectRow?.ts ?? null),
    decideMs: dt(detectRow?.ts ?? null, decisionRow?.ts ?? null),
    switchMs: dt(decisionRow?.ts ?? null, switchRow?.ts ?? null),
    tDetectIso: detectRow?.ts ?? null,
    tDecisionIso: decisionRow?.ts ?? null,
    tSwitchIso: switchRow?.ts ?? null,
    observationJson,
  };
}

function faultKeyOf(fault: ScenarioSpec["fault"]): "crash" | "linkloss" | "overload" {
  switch (fault) {
    case "CRASH":
      return "crash";
    case "LINK_LOSS":
      return "linkloss";
    case "OVERLOAD":
      return "overload";
  }
}

/** SI-2 and PS-006 event order: every route change must be preceded by an audited PASS. */
export function orderValid(rows: readonly AuditRecord[]): boolean {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.event === "failover_done") {
      let lastEval: AuditRecord | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (rows[j].event === "policy_evaluated") {
          lastEval = rows[j];
          break;
        }
      }
      if (!lastEval || lastEval.decision !== "PASS" || lastEval.replica !== r.replica) {
        return false;
      }
    }
    if (r.event === "service_restored") {
      let lastEval: AuditRecord | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (rows[j].event === "policy_evaluated" || rows[j].event === "failover_done") {
          lastEval = rows[j];
          break;
        }
      }
      if (!lastEval) return false;
      if (lastEval.event === "policy_evaluated" && (lastEval.decision !== "PASS" || lastEval.replica !== r.replica)) {
        return false;
      }
    }
    if (r.event === "failover_refused") {
      let lastEval: AuditRecord | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (rows[j].event === "policy_evaluated") {
          lastEval = rows[j];
          break;
        }
      }
      if (!lastEval || lastEval.decision !== "FAIL") return false;
    }
  }
  return true;
}
