/**
 * Front door + fixed-schedule probe.
 * The front door reads an immutable route snapshot: UNAVAILABLE ⇒ 503 no_compliant_replica
 * (fail closed); an upstream failure is reported to the monitor as a passive signal.
 * The probe keeps an absolute-time schedule (no drift): 50 ms during scenario runs,
 * 200 ms while idle. Live probes stay in a ring buffer; run probes are captured for evidence.
 */

import type { HealthReason, ProbeResult, ReplicaId, RouteTable } from "./models";
import { sleep } from "./replicas";

export interface FrontDoorResponse {
  status: number;
  ok: boolean;
  servedBy: ReplicaId | null;
  epoch: number;
  latencyMs: number;
  error: string | null;
}

export interface FrontDoorDeps {
  getRoute: () => RouteTable;
  dataPathRequest: (replica: ReplicaId) => Promise<
    { ok: true; latencyMs: number } | { ok: false; latencyMs: number; error: string; reason: HealthReason }
  >;
  passiveFailure: (replica: ReplicaId, reason: HealthReason) => void;
  lastDecisionPassed: (replica: ReplicaId) => boolean | null;
  onSafetyViolation: (replica: ReplicaId) => void;
}

export class FrontDoor {
  private deps: FrontDoorDeps;

  constructor(deps: FrontDoorDeps) {
    this.deps = deps;
  }

  async request(): Promise<FrontDoorResponse> {
    const route = this.deps.getRoute();
    if (route.mode !== "SERVING" || route.active === null) {
      return {
        status: 503,
        ok: false,
        servedBy: null,
        epoch: route.epoch,
        latencyMs: 0.2,
        error: "http_status",
      };
    }
    const target = route.active;
    const t0 = performance.now();
    const res = await this.deps.dataPathRequest(target);
    const latencyMs = performance.now() - t0;
    if (!res.ok) {
      this.deps.passiveFailure(target, res.reason);
      return { status: 502, ok: false, servedBy: null, epoch: route.epoch, latencyMs, error: res.error };
    }
    // Safety invariant (SI-1): only a replica whose latest evaluation PASSED can be served.
    const lastPassed = this.deps.lastDecisionPassed(target);
    if (lastPassed !== true) this.deps.onSafetyViolation(target);
    return { status: 200, ok: true, servedBy: target, epoch: route.epoch, latencyMs, error: null };
  }
}

export class ProbeLoop {
  private stopped = false;
  private seq = 0;
  private nextAt = 0;
  private frontDoor: FrontDoor;
  private intervals: { probe: number; idle: number };
  private hooks: { onRecord: (r: ProbeResult) => void };
  /** True while a scenario run captures records (50 ms cadence). */
  capturing = false;

  constructor(
    frontDoor: FrontDoor,
    intervals: { probe: number; idle: number },
    hooks: { onRecord: (r: ProbeResult) => void },
  ) {
    this.frontDoor = frontDoor;
    this.intervals = intervals;
    this.hooks = hooks;
  }

  run(): Promise<void> {
    this.nextAt = performance.now();
    return this.loop();
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const interval = this.capturing ? this.intervals.probe : this.intervals.idle;
      this.nextAt += interval;
      const now = performance.now();
      if (this.nextAt > now) {
        await sleep(this.nextAt - now);
      } else if (this.nextAt < now - interval) {
        this.nextAt = now; // fell behind (e.g. event-loop stall): skip slots, never burst
      }
      if (this.stopped) break;
      void this.fire(this.seq++);
    }
  }

  private async fire(seq: number): Promise<void> {
    const tSendNs = process.hrtime.bigint();
    const res = await this.frontDoor.request();
    const tRecvNs = tSendNs + BigInt(Math.round(res.latencyMs * 1e6));
    this.hooks.onRecord({
      seq,
      tSendNs: Number(tSendNs),
      tRecvNs: Number(tRecvNs),
      status: res.status,
      ok: res.ok,
      latencyMs: Math.round(res.latencyMs * 1000) / 1000,
      servedBy: res.servedBy,
      epoch: res.epoch,
      error: res.error,
    });
  }

  stop(): void {
    this.stopped = true;
  }
}
