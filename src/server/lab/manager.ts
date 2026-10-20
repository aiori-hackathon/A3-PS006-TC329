/**
 * Failover manager — the ONLY writer of the route table (PS-006 System Design §5.4).
 * All transitions are serialized through one event queue; every route change is
 * preceded by an audited policy_evaluated PASS (safety property SI-2).
 */

import type { AuditLog } from "./audit";
import type {
  AuditDecision,
  Decision,
  HealthReason,
  HealthState,
  Observation,
  ReplicaId,
  RouteTable,
} from "./models";
import { observe } from "./observer";
import type { Policy } from "./policy";
import { evaluate } from "./policy";
import type { ReplicaMonitor } from "./monitor";
import type { ReplicaSim } from "./replicas";
import { sleep } from "./replicas";

export type ManagerEvent =
  | { kind: "health"; replica: ReplicaId; state: HealthState; reason: HealthReason }
  | { kind: "admin_switch"; to: ReplicaId; resolve: (r: SwitchResult) => void }
  | { kind: "reset"; resolve: () => void };

export interface SwitchResult {
  result: "SWITCHED" | "REFUSED" | "NOOP";
  epoch: number;
  reasons: string[];
  decision: Decision | null;
}

export interface ManagerDeps {
  audit: () => AuditLog;
  policy: () => Policy;
  monitors: Record<ReplicaId, ReplicaMonitor>;
  replicas: Record<ReplicaId, ReplicaSim>;
  decisionTimeoutMs: number;
  reevaluateIntervalMs: number;
  initialActive: ReplicaId;
  onRouteChange: () => void;
  onGate: (replicaId: ReplicaId, obs: Observation, decision: Decision, replayOk: boolean) => void;
}

export class FailoverManager {
  route: RouteTable = { mode: "STARTING", active: null, epoch: 0 };
  lastDecision: Record<ReplicaId, Decision | null> = { A: null, B: null };
  private deps: ManagerDeps;
  private queue: ManagerEvent[] = [];
  private waiter: (() => void) | null = null;
  private stopped = false;

  constructor(deps: ManagerDeps) {
    this.deps = deps;
  }

  submit(ev: ManagerEvent): void {
    this.queue.push(ev);
    this.waiter?.();
    this.waiter = null;
  }

  other(id: ReplicaId): ReplicaId {
    return id === "A" ? "B" : "A";
  }

  stop(): void {
    this.stopped = true;
    this.waiter?.();
  }

  async run(): Promise<void> {
    await this.start();
    this.deps.onRouteChange();
    while (!this.stopped) {
      const ev = this.queue.shift();
      if (ev) {
        await this.handle(ev);
        continue;
      }
      await Promise.race([
        new Promise<void>((resolve) => {
          this.waiter = () => {
            this.waiter = null;
            resolve();
          };
        }),
        sleep(this.deps.reevaluateIntervalMs),
      ]);
      if (this.stopped) break;
      if (this.queue.length === 0 && this.route.mode === "UNAVAILABLE") {
        await this.reevaluate();
      }
    }
  }

  private async handle(ev: ManagerEvent): Promise<void> {
    switch (ev.kind) {
      case "health":
        await this.onHealth(ev.replica, ev.state, ev.reason);
        return;
      case "admin_switch":
        await this.onAdminSwitch(ev.to, ev.resolve);
        return;
      case "reset":
        await this.start();
        this.deps.onRouteChange();
        ev.resolve();
        return;
    }
  }

  /** Initial selection: initial active first, then the other; policy-gated. */
  private async start(): Promise<void> {
    this.route = { mode: "STARTING", active: null, epoch: 0 };
    this.lastDecision = { A: null, B: null };
    for (const rid of [this.deps.initialActive, this.other(this.deps.initialActive)]) {
      if (this.deps.monitors[rid].state === "UNHEALTHY") continue;
      const decision = await this.gate(rid);
      if (decision.passed) {
        this.route = { mode: "SERVING", active: rid, epoch: 0 };
        return;
      }
    }
    this.route = { mode: "UNAVAILABLE", active: null, epoch: 0 };
    this.deps.audit().emit("service_unavailable", { decision: "DOWN", reason: "NO_COMPLIANT_REPLICA" });
  }

  /** The policy gate: observe → evaluate → audit. Used by every route change. */
  private async gate(replicaId: ReplicaId): Promise<Decision> {
    const policy = this.deps.policy();
    const obs = await observe(this.deps.replicas[replicaId], {
      decisionTimeoutMs: this.deps.decisionTimeoutMs,
      checkLegacy: policy.tlsEnforcement === "no_legacy_support",
      minVersion: policy.tlsMinVersion,
    });
    const decision = evaluate(policy, obs);
    this.lastDecision[replicaId] = decision;

    // Determinism evidence: replay reconstructed inputs from serialized representation.
    const serializedObs = JSON.stringify(obs);
    const serializedPolicy = JSON.stringify(policy);
    let replayOk = true;
    for (let i = 0; i < 3; i++) {
      const reconstructedPolicy = JSON.parse(serializedPolicy);
      const reconstructedObs = JSON.parse(serializedObs);
      const replay = evaluate(reconstructedPolicy, reconstructedObs);
      if (replay.passed !== decision.passed || replay.reasons.join("+") !== decision.reasons.join("+")) {
        replayOk = false;
      }
    }
    this.deps.onGate(replicaId, obs, decision, replayOk);

    this.deps.audit().emit("policy_evaluated", {
      replica: replicaId,
      decision: decision.passed ? "PASS" : "FAIL",
      reason: decision.reasons.length > 0 ? decision.reasons.join("+") : "-",
      policy: decision.policySha,
    });
    return decision;
  }

  private async onHealth(replicaId: ReplicaId, state: HealthState, reason: HealthReason): Promise<void> {
    const audit = this.deps.audit();
    const decision: AuditDecision = state === "HEALTHY" || state === "UNHEALTHY" ? state : "-";
    audit.emit("health_changed", {
      replica: replicaId,
      decision,
      reason: state === "UNHEALTHY" ? reason : "-",
    });
    if (state === "UNHEALTHY") {
      await this.onUnhealthy(replicaId, reason);
    } else if (state === "HEALTHY") {
      await this.onHealthy(replicaId);
    }
  }

  private async onUnhealthy(replicaId: ReplicaId, reason: HealthReason): Promise<void> {
    if (this.route.mode !== "SERVING" || this.route.active !== replicaId) return;
    const audit = this.deps.audit();
    audit.emit("failure_detected", { replica: replicaId, decision: "UNHEALTHY", reason });
    this.route = { mode: "EVALUATING", active: replicaId, epoch: this.route.epoch };
    this.deps.onRouteChange();

    const candidate = this.other(replicaId);
    const decision = await this.gate(candidate);
    if (decision.passed && this.deps.monitors[candidate].state === "HEALTHY") {
      this.route = { mode: "SERVING", active: candidate, epoch: this.route.epoch + 1 };
      audit.emit("failover_done", { replica: candidate, decision: "SWITCHED", policy: decision.policySha });
      this.deps.onRouteChange();
    } else {
      const reasons = decision.passed
        ? "R1_UNREACHABLE" // observed fine but not healthy ⇒ effectively unreachable now
        : decision.reasons.join("+");
      audit.emit("failover_refused", { replica: candidate, decision: "REFUSED", reason: reasons });
      this.route = { mode: "UNAVAILABLE", active: null, epoch: this.route.epoch };
      audit.emit("service_unavailable", { decision: "DOWN", reason: "NO_COMPLIANT_REPLICA" });
      this.deps.onRouteChange();
    }
  }

  private async onHealthy(replicaId: ReplicaId): Promise<void> {
    if (this.route.mode !== "UNAVAILABLE") return; // sticky active: no automatic failback
    const decision = await this.gate(replicaId);
    if (decision.passed) {
      this.route = { mode: "SERVING", active: replicaId, epoch: this.route.epoch + 1 };
      this.deps.audit().emit("service_restored", { replica: replicaId, decision: "UP" });
      this.deps.onRouteChange();
    }
  }

  /** While unavailable: re-gate healthy replicas periodically (policy reloads, slow recovery). */
  private async reevaluate(): Promise<void> {
    for (const rid of ["A", "B"] as const) {
      if (this.route.mode !== "UNAVAILABLE") return;
      if (this.deps.monitors[rid].state === "HEALTHY") {
        await this.onHealthy(rid);
      }
    }
  }

  private async onAdminSwitch(to: ReplicaId, resolve: (r: SwitchResult) => void): Promise<void> {
    const audit = this.deps.audit();
    audit.emit("admin_switch_requested", { replica: to });
    if (this.route.mode === "SERVING" && this.route.active === to) {
      resolve({ result: "NOOP", epoch: this.route.epoch, reasons: [], decision: null });
      return;
    }
    const decision = await this.gate(to);
    const healthy = this.deps.monitors[to].state === "HEALTHY";
    if (decision.passed && healthy) {
      const wasUnavailable = this.route.mode === "UNAVAILABLE";
      this.route = { mode: "SERVING", active: to, epoch: this.route.epoch + 1 };
      audit.emit("failover_done", { replica: to, decision: "SWITCHED", policy: decision.policySha });
      if (wasUnavailable) audit.emit("service_restored", { replica: to, decision: "UP" });
      this.deps.onRouteChange();
      resolve({ result: "SWITCHED", epoch: this.route.epoch, reasons: [], decision });
    } else {
      const reasons = decision.passed ? ["R1_UNREACHABLE"] : [...decision.reasons];
      audit.emit("failover_refused", { replica: to, decision: "REFUSED", reason: reasons.join("+") || "R1_UNREACHABLE" });
      this.deps.onRouteChange();
      resolve({ result: "REFUSED", epoch: this.route.epoch, reasons, decision });
    }
  }
}
