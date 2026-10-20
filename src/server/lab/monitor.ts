/**
 * Health monitor — one loop per replica (100 ms), classification, passive detection.
 * Transitions are pushed to the failover manager's queue (the only route writer).
 * Every check (pass or fail) is broadcast as a tick for the live console.
 */

import type { HealthReason, HealthState, HealthTick } from "./models";
import { HealthTracker } from "./health";
import { ReplicaSim } from "./replicas";

export interface MonitorHooks {
  onTransition: (replica: ReplicaSim["id"], state: HealthState, reason: HealthReason) => void;
  onTick: (tick: HealthTick) => void;
}

export class ReplicaMonitor {
  readonly replicaId: ReplicaSim["id"];
  tracker: HealthTracker;
  private replica: ReplicaSim;
  private cfg: {
    healthIntervalMs: number;
    connectTimeoutMs: number;
    readTimeoutMs: number;
    latencyThresholdMs: number;
    failureThreshold: number;
    recoveryThreshold: number;
  };
  private hooks: MonitorHooks;
  private wake: (() => void) | null = null;
  private stopped = false;
  lastTick: HealthTick | null = null;

  constructor(
    replica: ReplicaSim,
    cfg: ReplicaMonitor["cfg"],
    hooks: MonitorHooks,
  ) {
    this.replica = replica;
    this.replicaId = replica.id;
    this.cfg = cfg;
    this.hooks = hooks;
    this.tracker = new HealthTracker(cfg.failureThreshold, cfg.recoveryThreshold);
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      const { ok, reason, latencyMs } = await this.replica.healthCheck({
        connectTimeoutMs: this.cfg.connectTimeoutMs,
        readTimeoutMs: this.cfg.readTimeoutMs,
        latencyThresholdMs: this.cfg.latencyThresholdMs,
      });
      const change = this.tracker.onResult(ok, reason);
      this.tick(ok, reason, latencyMs);
      if (change) this.hooks.onTransition(this.replicaId, change, this.tracker.lastReason);
      await this.waitInterruptible(this.cfg.healthIntervalMs);
    }
  }

  /** A failed proxied request counts as one failure signal and triggers an immediate extra check. */
  passiveFailure(reason: HealthReason): void {
    const change = this.tracker.onPassiveFailure(reason);
    this.tick(false, reason, null);
    if (change) this.hooks.onTransition(this.replicaId, change, this.tracker.lastReason);
    this.wake?.(); // run the next active check immediately
  }

  reset(): void {
    this.tracker.reset();
    this.tick(true, "-", null);
  }

  stop(): void {
    this.stopped = true;
    this.wake?.();
  }

  get state(): HealthState {
    return this.tracker.state;
  }

  get lastReason(): HealthReason {
    return this.tracker.lastReason;
  }

  get consecutiveFails(): number {
    return this.tracker.consecutiveFail;
  }

  private tick(ok: boolean, reason: HealthReason, latencyMs: number | null): void {
    const t: HealthTick = {
      replica: this.replicaId,
      ok,
      reason,
      latencyMs,
      health: this.tracker.state,
      consecutiveFails: this.tracker.consecutiveFail,
      atNs: Number(process.hrtime.bigint()),
    };
    this.lastTick = t;
    this.hooks.onTick(t);
  }

  private waitInterruptible(ms: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
    });
  }
}
