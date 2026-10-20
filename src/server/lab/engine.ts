/**
 * LabEngine — the singleton that wires the whole PS-006 lab inside the Next.js server:
 * replicas + monitors + failover manager + front door + probe + audit + policy,
 * plus the realtime publisher (batched bridge POST) and Prisma persistence.
 * Stored on globalThis so dev HMR cannot spawn duplicate timer sets.
 */

import { db } from "@/lib/db";

import { AuditLog, type AuditRecord } from "./audit";
import { liveOutage } from "./analyze";
import {
  ENGINE_CONFIG,
  type FaultKind,
  type HealthReason,
  type HealthState,
  type HealthTick,
  type Mode,
  type ProbeResult,
  type ReplicaFacts,
  type ReplicaId,
  type RouteTable,
} from "./models";
import { FailoverManager, type SwitchResult } from "./manager";
import { ReplicaMonitor, type MonitorHooks } from "./monitor";
import { FrontDoor, ProbeLoop } from "./probe";
import { DEFAULT_POLICY_YAML, PolicyError, parsePolicy, type Policy } from "./policy";
import { PROFILES, ReplicaSim, faultReason, sleep } from "./replicas";
import {
  runScenarioBatch,
  SCENARIOS,
  type BuiltEvidence,
  type RunSummary,
  type ScenarioRunStatus,
  type ScoreOut,
} from "./runner";

const REALTIME_URL = process.env.REALTIME_URL ?? "http://127.0.0.1:3033/publish";
const REALTIME_TOKEN = process.env.REALTIME_TOKEN ?? "interlock-dev-token";

export class RunLockedError extends Error {
  code = "run_locked" as const;
}
export class ReplicaActiveError extends Error {
  code = "replica_active" as const;
}
export class NoFaultError extends Error {
  code = "no_fault" as const;
}

interface LabEvent {
  type: "state" | "audit" | "probe" | "health" | "fault" | "policy" | "run";
  payload: unknown;
  ts: string;
}

export interface GateLogEntry {
  replicaId: ReplicaId;
  passed: boolean;
  reasons: string;
  replayOk: boolean;
  atIso: string;
  policy: Policy;
  observation: unknown;
  decision: { passed: boolean; reasons: readonly string[] };
}

export interface ReplicaView extends ReplicaFacts {
  health: HealthState;
  lastReason: HealthReason;
  lastLatencyMs: number | null;
  consecutiveFails: number;
  fault: FaultKind | null;
  lastDecision: { passed: boolean; reasons: string[]; atIso: string | null } | null;
}

export interface LabSnapshot {
  runId: string;
  mode: Mode;
  active: ReplicaId | null;
  epoch: number;
  runLock: boolean;
  safetyViolations: number;
  startedAt: string;
  policy: {
    id: string;
    sha: string;
    minVersion: string;
    enforcement: string;
    allowedLocations: string[];
    requireCertLabelMatch: boolean;
    requireMinimalLogging: boolean;
    yaml: string;
  };
  controller: Record<string, number>;
  replicas: ReplicaView[];
  recentAudit: AuditRecord[];
  recentProbe: ProbeResult[];
  recentHealth: Record<ReplicaId, HealthTick[]>;
  probeStats: {
    intervalMs: number;
    okRate: number | null;
    liveDowntimeMs: number | null;
    liveOutageOpen: boolean | null;
  };
  scenarioStatus: ScenarioRunStatus | null;
}

/**
 * Sequential asynchronous audit persistence queue to prevent race conditions
 * and out-of-order writes in SQLite.
 */
export class AuditPersistenceQueue {
  private queue: Array<{ task: () => Promise<void>; runId?: string }> = [];
  private running = false;
  private lastError: Error | null = null;
  private failedRuns = new Set<string>();

  push(task: () => Promise<void>, runId?: string): void {
    this.queue.push({ task, runId });
    void this.drain();
  }

  hasFailed(runId?: string): boolean {
    if (!runId) return this.failedRuns.size > 0 || this.lastError !== null;
    return this.failedRuns.has(runId);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await item.task();
      } catch (err) {
        this.lastError = err as Error;
        if (item.runId) {
          this.failedRuns.add(item.runId);
        }
        console.error("[interlock-audit-db]", err);
      }
    }
    this.running = false;
  }

  async flush(runId?: string): Promise<void> {
    while (this.running || this.queue.length > 0) {
      await sleep(10);
    }
    if (runId && this.failedRuns.has(runId)) {
      throw new Error(`Audit persistence failed for run ${runId}`);
    }
    if (this.lastError) {
      const err = this.lastError;
      this.lastError = null;
      throw err;
    }
  }
}

/**
 * Generates collision-free live session IDs across process restarts and scenario batches.
 */
export function generateLiveRunId(counter: number = 0, timestampMs: number = Date.now()): string {
  return `live-${timestampMs.toString(36)}-${counter}`;
}

export class LabEngine {
  readonly cfg = ENGINE_CONFIG;
  cancelled = false;
  servedByNoncompliantRun = 0;

  private policy: Policy;
  private policyYaml: string;
  private replicas: Record<ReplicaId, ReplicaSim>;
  private monitors: Record<ReplicaId, ReplicaMonitor>;
  private manager!: FailoverManager;
  private audit: AuditLog;
  private auditQueue = new AuditPersistenceQueue();
  private probe: ProbeLoop;
  private probeRing: ProbeResult[] = [];
  private healthRings: Record<ReplicaId, HealthTick[]> = { A: [], B: [] };
  private runProbeRecords: ProbeResult[] = [];
  private gateLog: GateLogEntry[] = [];
  private lastDecisionAt: Partial<Record<ReplicaId, string>> = {};
  private bootSessionPrefix = `live-${Date.now().toString(36)}`;
  private liveRunCounter = 0;
  private startedAtIso = new Date().toISOString();
  private scenarioStatus: ScenarioRunStatus | null = null;
  private publisherQueue: LabEvent[] = [];
  private publishTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  readonly readyPromise: Promise<void>;

  constructor() {
    this.policyYaml = DEFAULT_POLICY_YAML;
    this.policy = parsePolicy(this.policyYaml);
    this.replicas = { A: new ReplicaSim("A", "compliant"), B: new ReplicaSim("B", "compliant") };

    // Monitors first (manager needs them; monitor hooks need a manager holder).
    const mgr: { current?: FailoverManager } = {};
    const monitorCfg = {
      healthIntervalMs: this.cfg.healthIntervalMs,
      connectTimeoutMs: this.cfg.connectTimeoutMs,
      readTimeoutMs: this.cfg.readTimeoutMs,
      latencyThresholdMs: this.cfg.latencyThresholdMs,
      failureThreshold: this.cfg.failureThreshold,
      recoveryThreshold: this.cfg.recoveryThreshold,
    };
    const onTransition: MonitorHooks["onTransition"] =
      (replica, state, reason) => mgr.current?.submit({ kind: "health", replica, state, reason });
    const onTick = (tick: HealthTick): void => {
      this.healthRings[tick.replica].push(tick);
      if (this.healthRings[tick.replica].length > 48) this.healthRings[tick.replica].shift();
      this.publish("health", tick);
    };
    this.monitors = {
      A: new ReplicaMonitor(this.replicas.A, monitorCfg, { onTransition, onTick }),
      B: new ReplicaMonitor(this.replicas.B, monitorCfg, { onTransition, onTick }),
    };

    this.manager = new FailoverManager({
      audit: () => this.audit,
      policy: () => this.policy,
      monitors: this.monitors,
      replicas: this.replicas,
      decisionTimeoutMs: this.cfg.decisionTimeoutMs,
      reevaluateIntervalMs: this.cfg.reevaluateIntervalMs,
      initialActive: "A",
      onRouteChange: () => this.publishState(),
      onGate: (replicaId, obs, decision, replayOk) => {
        this.lastDecisionAt[replicaId] = new Date().toISOString();
        this.gateLog.push({
          replicaId,
          passed: decision.passed,
          reasons: decision.reasons.join("+"),
          replayOk,
          atIso: this.lastDecisionAt[replicaId]!,
          policy: this.policy,
          observation: obs,
          decision: { passed: decision.passed, reasons: decision.reasons },
        });
      },
    });
    mgr.current = this.manager;

    const initialLiveRunId = `${this.bootSessionPrefix}-${this.liveRunCounter}`;
    this.audit = new AuditLog(initialLiveRunId, (row) => this.persistAuditRow(row));
    this.audit.emit("controller_started");

    const frontDoor = new FrontDoor({
      getRoute: (): RouteTable => this.manager.route,
      dataPathRequest: (replica) =>
        this.replicas[replica].dataPathRequest({
          connectTimeoutMs: this.cfg.connectTimeoutMs,
          upstreamReadTimeoutMs: this.cfg.upstreamReadTimeoutMs,
        }),
      passiveFailure: (replica, reason) => this.monitors[replica].passiveFailure(reason),
      lastDecisionPassed: (replica) => {
        const d = this.manager.lastDecision[replica];
        return d ? d.passed : null;
      },
      onSafetyViolation: () => {
        this.servedByNoncompliantRun += 1;
      },
    });
    this.probe = new ProbeLoop(
      frontDoor,
      { probe: this.cfg.probeIntervalMs, idle: this.cfg.idleProbeIntervalMs },
      {
        onRecord: (r) => {
          this.probeRing.push(r);
          if (this.probeRing.length > 400) this.probeRing.shift();
          if (this.probe.capturing) this.runProbeRecords.push(r);
          this.publish("probe", r);
        },
      },
    );

    this.publishTimer = setInterval(() => this.flushPublisher(), 40);
    this.readyPromise = this.init();
  }

  private async init(): Promise<void> {
    try {
      await this.persistPolicyFile();
    } catch (e) {
      this.log(`initial policy persist failed: ${(e as Error).message}`);
    }
    // Start all manager/monitor/probe loops once initial policy readiness is established
    void this.manager.run().catch((e) => this.log(`manager loop crashed: ${(e as Error).stack}`));
    void this.monitors.A.run().catch((e) => this.log(`monitor A crashed: ${(e as Error).stack}`));
    void this.monitors.B.run().catch((e) => this.log(`monitor B crashed: ${(e as Error).stack}`));
    void this.probe.run().catch((e) => this.log(`probe loop crashed: ${(e as Error).stack}`));
  }

  async ready(): Promise<this> {
    await this.readyPromise;
    return this;
  }

  // ─── scenario host surface ────────────────────────────────────────────────────

  get timings() {
    return {
      warmupMs: this.cfg.warmupMs,
      observeMs: this.cfg.observeMs,
      restoreAtMs: this.cfg.restoreAtMs,
      settleMs: this.cfg.settleMs,
      probeIntervalMs: this.cfg.probeIntervalMs,
    };
  }

  async beginScenarioRun(runId: string, bProfile: string): Promise<void> {
    this.resetReplicas(bProfile);
    this.openAudit(runId);
    this.audit.emit("controller_started");
    this.audit.emit("policy_loaded", { policy: this.policy.sha });
    await this.managerReset();
    this.probe.capturing = true;
    this.runProbeRecords = [];
    this.gateLog = [];
    this.servedByNoncompliantRun = 0;
    this.probeRing = [];
    this.publishState();
  }

  injectFaultInternal(replica: ReplicaId, fault: FaultKind): void {
    this.applyFault(replica, fault);
  }

  clearFaultInternal(replica: ReplicaId): void {
    this.removeFault(replica);
  }

  clearAllFaultsInternal(): void {
    for (const rid of ["A", "B"] as const) {
      if (this.replicas[rid].fault) this.removeFault(rid);
    }
  }

  endScenarioCapture(): { audit: readonly AuditRecord[]; probe: readonly ProbeResult[] } {
    this.probe.capturing = false;
    return { audit: this.audit.records, probe: this.runProbeRecords };
  }

  async flushAuditPersistence(runId?: string): Promise<void> {
    await this.auditQueue.flush(runId);
  }

  async getPersistedAudit(runId: string): Promise<readonly AuditRecord[]> {
    const rows = await db.auditEvent.findMany({
      where: { runId },
      orderBy: { seq: "asc" },
    });
    return rows.map((r) => ({
      seq: r.seq,
      ts: r.ts.toISOString(),
      runId: r.runId,
      event: r.event as AuditRecord["event"],
      replica: r.replica as AuditRecord["replica"],
      decision: r.decision as AuditRecord["decision"],
      reason: r.reason,
      policy: r.policy,
      prev: r.prev,
      hash: r.hash,
    }));
  }

  lastGateEvidence(replicaId: ReplicaId): GateLogEntry | null {
    for (let i = this.gateLog.length - 1; i >= 0; i--) {
      if (this.gateLog[i].replicaId === replicaId) {
        return this.gateLog[i];
      }
    }
    return null;
  }

  determinismOk(): boolean {
    return this.gateLog.length > 0 && this.gateLog.every((e) => e.replayOk);
  }

  setScenarioStatus(status: ScenarioRunStatus): void {
    this.scenarioStatus = status;
  }

  /** After a batch: open a fresh live run so the console keeps its own audit chain. */
  endBatch(): void {
    this.probe.capturing = false;
    this.liveRunCounter += 1;
    this.openAudit(`${this.bootSessionPrefix}-${this.liveRunCounter}`);
    this.audit.emit("controller_started");
    this.audit.emit("policy_loaded", { policy: this.policy.sha });
    this.runProbeRecords = [];
    this.gateLog = [];
    this.servedByNoncompliantRun = 0;
    this.probeRing = [];
    this.publishState();
  }

  async persistRun(args: {
    summary: RunSummary;
    batchId: string;
    evidence: BuiltEvidence;
    score: ScoreOut;
    audit: readonly AuditRecord[];
    probe: readonly ProbeResult[];
    tFaultIso: string;
    tRunStartIso?: string;
    observationJson: string;
  }): Promise<void> {
    const { summary, evidence, score } = args;
    try {
      await db.$transaction(async (tx) => {
        await tx.run.create({
          data: {
            id: summary.runId,
            batchId: args.batchId,
            scenario: summary.scenario,
            repeat: summary.repeat,
            fault: SCENARIOS[summary.scenario]?.fault.toLowerCase() ?? "crash",
            bProfile: summary.bProfile,
            expect: SCENARIOS[summary.scenario]?.expect ?? "FAILOVER",
            status: summary.status ?? "COMPLETED",
            startedAt: new Date(args.tRunStartIso ?? args.tFaultIso),
            endedAt: new Date(),
            tFaultIso: new Date(args.tFaultIso),
            tDetectIso: evidence.tDetectIso ? new Date(evidence.tDetectIso) : null,
            tDecisionIso: evidence.tDecisionIso ? new Date(evidence.tDecisionIso) : null,
            tSwitchIso: evidence.tSwitchIso ? new Date(evidence.tSwitchIso) : null,
            detectMs: evidence.detectMs,
            decideMs: evidence.decideMs,
            switchMs: evidence.switchMs,
            outcome: summary.outcome,
            reasons: summary.reasons,
            downtimeMs: summary.downtimeMs,
            outageOpen: summary.outageOpen ?? undefined,
            failedRequests: evidence.failedRequests,
            servedByNoncompliant: summary.servedByNoncompliant,
            auditChainOk: summary.auditChainOk,
            auditOrderOk: summary.auditOrderOk,
            scoreTotal: score.total,
            grade: score.grade,
            observationJson: args.observationJson,
          },
        });
        await tx.scoreComponent.createMany({
          data: score.components.map((c) => ({
            runId: summary.runId,
            key: c.key,
            label: c.label,
            points: c.points,
            maxPoints: c.maxPoints,
            note: c.note,
          })),
        });
        for (let i = 0; i < args.probe.length; i += 200) {
          const chunk = args.probe.slice(i, i + 200);
          await tx.probeRecord.createMany({
            data: chunk.map((p) => ({
              runId: summary.runId,
              seq: p.seq,
              tSend: new Date(p.tSendNs / 1e6),
              ok: p.ok,
              status: p.status ?? undefined,
              latencyMs: p.latencyMs ?? undefined,
              servedBy: p.servedBy ?? undefined,
              epoch: p.epoch ?? undefined,
              error: p.error ?? undefined,
            })),
          });
        }
      });
      this.log(`persisted run ${summary.runId} atomically (score ${score.total} ${score.grade})`);
    } catch (err) {
      this.log(`persistRun failed for ${summary.runId}: ${(err as Error).message}`);
      throw err;
    }
  }

  publishRun(status: ScenarioRunStatus): void {
    this.publish("run", status);
  }

  log(message: string): void {
    console.log(`[interlock] ${message}`);
  }

  // ─── public actions (API layer) ───────────────────────────────────────────────

  get runLock(): boolean {
    return this.scenarioStatus?.running === true;
  }

  get scenarioRunStatus(): ScenarioRunStatus | null {
    return this.scenarioStatus;
  }

  injectFault(replica: ReplicaId, fault: FaultKind): void {
    this.assertUnlocked();
    this.applyFault(replica, fault);
  }

  clearFault(replica: ReplicaId): void {
    this.assertUnlocked();
    if (!this.replicas[replica].fault) throw new NoFaultError(`no active fault on replica ${replica}`);
    this.removeFault(replica);
  }

  setProfile(replica: ReplicaId, profileKey: string): void {
    this.assertUnlocked();
    if (!PROFILES[profileKey]) throw new PolicyError(`unknown profile: ${profileKey}`);
    if (replica === "A" && profileKey !== "compliant") {
      throw new PolicyError("replica A always runs the compliant profile");
    }
    if (this.manager.route.active === replica) {
      throw new ReplicaActiveError("a profile change recreates the replica; it must be standby");
    }
    const sim = this.replicas[replica];
    sim.profile = PROFILES[profileKey];
    sim.fault = null;
    sim.degradedMs = 0;
    sim.restartingUntilMs = 0;
    this.monitors[replica].reset();
    this.publish("state", this.statePayload());
    this.publish("fault", { replica, fault: null, action: "recreated" });
  }

  async manualSwitch(to: ReplicaId): Promise<SwitchResult> {
    this.assertUnlocked();
    return new Promise<SwitchResult>((resolve) => {
      this.manager.submit({ kind: "admin_switch", to, resolve });
    });
  }

  async resetLiveRun(): Promise<string> {
    this.assertUnlocked();
    this.liveRunCounter += 1;
    const runId = `${this.bootSessionPrefix}-${this.liveRunCounter}`;
    this.resetReplicas(null); // keep current B profile
    this.openAudit(runId);
    this.audit.emit("controller_started");
    this.audit.emit("policy_loaded", { policy: this.policy.sha });
    await this.managerReset();
    this.probe.capturing = false;
    this.probeRing = [];
    this.gateLog = [];
    this.servedByNoncompliantRun = 0;
    this.startedAtIso = new Date().toISOString();
    this.publishState();
    return runId;
  }

  validatePolicyYaml(yaml: string): { valid: true; parsed: Policy; sha: string } | { valid: false; error: string } {
    try {
      const parsed = parsePolicy(yaml);
      return { valid: true, parsed, sha: parsed.sha };
    } catch (err) {
      return { valid: false, error: err instanceof PolicyError ? err.message : (err as Error).message };
    }
  }

  async reloadPolicy(yaml: string): Promise<{ ok: boolean; sha?: string; parsed?: Policy; error?: string }> {
    this.assertUnlocked();
    const result = this.validatePolicyYaml(yaml);
    if (!result.valid) {
      this.audit.emit("policy_load_failed", { reason: "POLICY_INVALID" });
      this.publish("policy", { event: "load_failed", sha: this.policy.sha, id: this.policy.policyId, error: result.error });
      return { ok: false, error: result.error };
    }

    try {
      await this.activatePolicyInDb(
        result.parsed.sha,
        yaml,
        JSON.stringify({
          id: result.parsed.policyId,
          allowedLocations: result.parsed.allowedLocations,
          tlsMinVersion: result.parsed.tlsMinVersion,
          tlsEnforcement: result.parsed.tlsEnforcement,
          requireCertLabelMatch: result.parsed.requireCertLabelMatch,
          requireMinimalLogging: result.parsed.requireMinimalLogging,
        }),
      );
    } catch (e) {
      const errorMsg = (e as Error).message;
      this.log(`policy persist failed: ${errorMsg}`);
      this.audit.emit("policy_load_failed", { reason: "PERSISTENCE_FAILED" });
      this.publish("policy", { event: "load_failed", sha: this.policy.sha, id: this.policy.policyId, error: errorMsg });
      return { ok: false, error: `Failed to persist policy: ${errorMsg}` };
    }

    // Mutate in-memory policy and emit audit ONLY after successful DB transaction
    this.policy = result.parsed;
    this.policyYaml = yaml;
    this.audit.emit("policy_loaded", { policy: result.parsed.sha });
    this.publish("policy", { event: "loaded", sha: result.parsed.sha, id: result.parsed.policyId });
    return { ok: true, sha: result.parsed.sha, parsed: result.parsed };
  }

  async startScenario(scenarioKey: string, repeats: number): Promise<void> {
    if (this.runLock) throw new RunLockedError("a scenario batch is already running");
    if (!SCENARIOS[scenarioKey]) throw new PolicyError(`unknown scenario: ${scenarioKey}`);
    // Fire and supervise: the batch runs in the background; the API returns immediately.
    void runScenarioBatch(this, scenarioKey, repeats).catch((e) =>
      this.log(`batch crashed: ${(e as Error).stack}`),
    );
  }

  cancelScenario(): void {
    if (!this.runLock) return;
    this.cancelled = true;
  }

  // ─── snapshot (REST) ─────────────────────────────────────────────────────────

  snapshot(): LabSnapshot {
    const last = this.probeRing.slice(-100);
    const okCount = last.filter((p) => p.ok).length;
    const outage = liveOutage(this.probeRing);
    return {
      runId: this.audit.runId,
      mode: this.manager.route.mode,
      active: this.manager.route.active,
      epoch: this.manager.route.epoch,
      runLock: this.runLock,
      safetyViolations: this.servedByNoncompliantRun,
      startedAt: this.startedAtIso,
      policy: {
        id: this.policy.policyId,
        sha: this.policy.sha,
        minVersion: this.policy.tlsMinVersion,
        enforcement: this.policy.tlsEnforcement,
        allowedLocations: [...this.policy.allowedLocations],
        requireCertLabelMatch: this.policy.requireCertLabelMatch,
        requireMinimalLogging: this.policy.requireMinimalLogging,
        yaml: this.policyYaml,
      },
      controller: {
        healthIntervalMs: this.cfg.healthIntervalMs,
        connectTimeoutMs: this.cfg.connectTimeoutMs,
        readTimeoutMs: this.cfg.readTimeoutMs,
        latencyThresholdMs: this.cfg.latencyThresholdMs,
        failureThreshold: this.cfg.failureThreshold,
        recoveryThreshold: this.cfg.recoveryThreshold,
        decisionTimeoutMs: this.cfg.decisionTimeoutMs,
        probeIntervalMs: this.cfg.probeIntervalMs,
        idleProbeIntervalMs: this.cfg.idleProbeIntervalMs,
        upstreamReadTimeoutMs: this.cfg.upstreamReadTimeoutMs,
        overloadDelayMs: this.cfg.overloadDelayMs,
      },
      replicas: (["A", "B"] as const).map((rid) => {
        const sim = this.replicas[rid];
        const mon = this.monitors[rid];
        const decision = this.manager.lastDecision[rid];
        return {
          ...sim.facts(),
          health: mon.state,
          lastReason: mon.lastReason,
          lastLatencyMs: mon.lastTick?.latencyMs ?? null,
          consecutiveFails: mon.consecutiveFails,
          fault: sim.fault,
          lastDecision: decision
            ? {
                passed: decision.passed,
                reasons: [...decision.reasons],
                atIso: this.lastDecisionAt[rid] ?? null,
              }
            : null,
        };
      }),
      recentAudit: this.audit.last(60),
      recentProbe: this.probeRing.slice(-160),
      recentHealth: { A: this.healthRings.A.slice(-24), B: this.healthRings.B.slice(-24) },
      probeStats: {
        intervalMs: this.probe.capturing ? this.cfg.probeIntervalMs : this.cfg.idleProbeIntervalMs,
        okRate: last.length > 0 ? okCount / last.length : null,
        liveDowntimeMs: outage ? outage.downtimeMs : null,
        liveOutageOpen: outage ? outage.open : null,
      },
      scenarioStatus: this.scenarioStatus,
    };
  }

  statePayload(): { mode: Mode; active: ReplicaId | null; epoch: number; runId: string; runLock: boolean } {
    return {
      mode: this.manager.route.mode,
      active: this.manager.route.active,
      epoch: this.manager.route.epoch,
      runId: this.audit.runId,
      runLock: this.runLock,
    };
  }

  currentPolicyYaml(): string {
    return this.policyYaml;
  }

  auditRecords(): readonly AuditRecord[] {
    return this.audit.records;
  }

  dispose(): void {
    this.disposed = true;
    this.monitors.A.stop();
    this.monitors.B.stop();
    this.probe.stop();
    this.manager.stop();
    if (this.publishTimer) clearInterval(this.publishTimer);
  }

  // ─── internals ───────────────────────────────────────────────────────────────

  private assertUnlocked(): void {
    if (this.runLock) throw new RunLockedError("scenario batch running — manual changes are locked");
  }

  private applyFault(replica: ReplicaId, fault: FaultKind): void {
    const sim = this.replicas[replica];
    sim.fault = fault;
    if (fault === "OVERLOAD") sim.degradedMs = this.cfg.overloadDelayMs;
    this.audit.emit("fault_injected", { replica, reason: faultReason(fault) });
    this.publish("fault", { replica, fault, action: "inject" });
  }

  private removeFault(replica: ReplicaId): void {
    const sim = this.replicas[replica];
    const fault = sim.fault;
    if (!fault) return;
    sim.fault = null;
    sim.degradedMs = 0;
    if (fault === "CRASH") sim.restartingUntilMs = Date.now() + 500; // container comes back up
    this.monitors[replica].reset();
    this.audit.emit("fault_cleared", { replica, reason: faultReason(fault as FaultKind) });
    this.publish("fault", { replica, fault, action: "clear" });
  }

  private resetReplicas(bProfile: string | null): void {
    const a = this.replicas.A;
    a.profile = PROFILES.compliant;
    a.fault = null;
    a.degradedMs = 0;
    a.restartingUntilMs = 0;
    const b = this.replicas.B;
    if (bProfile && PROFILES[bProfile]) b.profile = PROFILES[bProfile];
    b.fault = null;
    b.degradedMs = 0;
    b.restartingUntilMs = 0;
    this.monitors.A.reset();
    this.monitors.B.reset();
  }

  private openAudit(runId: string): void {
    this.audit = new AuditLog(runId, (row) => this.persistAuditRow(row));
    this.lastDecisionAt = {};
  }

  private async managerReset(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.manager.submit({ kind: "reset", resolve });
    });
  }

  private persistAuditRow(row: AuditRecord): void {
    if (this.disposed) return;
    this.auditQueue.push(async () => {
      await db.auditEvent.create({
        data: {
          runId: row.runId,
          seq: row.seq,
          ts: new Date(row.ts),
          event: row.event,
          replica: row.replica,
          decision: row.decision,
          reason: row.reason,
          policy: row.policy,
          prev: row.prev,
          hash: row.hash,
        },
      });
    }, row.runId);
  }

  private async activatePolicyInDb(sha: string, yaml: string, parsedJson: string): Promise<void> {
    await db.$transaction(async (tx) => {
      const existing = await tx.policyFile.findUnique({ where: { sha } });
      if (existing) {
        await tx.policyFile.update({
          where: { sha },
          data: { yaml, parsedJson, active: true },
        });
      } else {
        await tx.policyFile.create({
          data: { sha, yaml, parsedJson, active: true },
        });
      }
      await tx.policyFile.updateMany({
        where: { sha: { not: sha }, active: true },
        data: { active: false },
      });
    });
  }

  private async persistPolicyFile(): Promise<void> {
    try {
      // 1. Look for currently active policy in database
      const activeInDb = await db.policyFile.findFirst({
        where: { active: true },
        orderBy: { createdAt: "desc" },
      });
      if (activeInDb) {
        try {
          const parsed = parsePolicy(activeInDb.yaml);
          this.policy = parsed;
          this.policyYaml = activeInDb.yaml;
          this.audit.emit("policy_loaded", { policy: this.policy.sha });
          this.log(`restored active policy ${parsed.policyId} (${parsed.sha}) from database`);
          return;
        } catch (e) {
          this.log(`persisted active policy invalid: ${(e as Error).message}`);
        }
      }

      // 2. If no active policy exists, look for the most recent valid policy in DB and activate it
      const anyInDb = await db.policyFile.findFirst({
        orderBy: { createdAt: "desc" },
      });
      if (anyInDb) {
        try {
          const parsed = parsePolicy(anyInDb.yaml);
          this.policy = parsed;
          this.policyYaml = anyInDb.yaml;
          await this.activatePolicyInDb(parsed.sha, anyInDb.yaml, JSON.stringify({ id: parsed.policyId }));
          this.audit.emit("policy_loaded", { policy: this.policy.sha });
          this.log(`activated existing persisted policy ${parsed.sha} from database`);
          return;
        } catch {
          // fall through to default
        }
      }

      // 3. Otherwise persist and activate default policy
      await this.activatePolicyInDb(this.policy.sha, this.policyYaml, JSON.stringify({ id: this.policy.policyId }));
      this.audit.emit("policy_loaded", { policy: this.policy.sha });
    } catch (err) {
      this.log(`initial policy persist failed: ${(err as Error).message}`);
      this.audit.emit("policy_loaded", { policy: this.policy.sha });
    }
  }

  private publishState(): void {
    this.publish("state", this.statePayload());
  }

  private publish(type: LabEvent["type"], payload: unknown): void {
    if (this.disposed) return;
    this.publisherQueue.push({ type, payload, ts: new Date().toISOString() });
    if (this.publisherQueue.length > 600) this.publisherQueue.splice(0, this.publisherQueue.length - 600);
  }

  private flushPublisher(): void {
    if (this.publisherQueue.length === 0) return;
    const events = this.publisherQueue.splice(0, this.publisherQueue.length);
    fetch(REALTIME_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lab-token": REALTIME_TOKEN },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(500),
    }).catch(() => {
      /* bridge down: clients fall back to REST polling; events are dropped */
    });
  }
}

const globalForEngine = globalThis as unknown as {
  __interlockEngine?: LabEngine;
  __interlockEngineStale?: boolean;
};

// When this module is re-evaluated (dev HMR), any existing instance was built
// from old code and must be rebuilt lazily on the next access. In production the
// module evaluates exactly once and the singleton simply lives.
if (globalForEngine.__interlockEngine) {
  globalForEngine.__interlockEngineStale = true;
}

/** Singleton accessor — boots the lab on first use (the first API call). */
export function getEngine(): LabEngine {
  if (globalForEngine.__interlockEngine && !globalForEngine.__interlockEngineStale) {
    return globalForEngine.__interlockEngine;
  }
  globalForEngine.__interlockEngine?.dispose();
  const engine = new LabEngine();
  globalForEngine.__interlockEngine = engine;
  globalForEngine.__interlockEngineStale = false;
  engine.log("engine booted");
  return engine;
}
