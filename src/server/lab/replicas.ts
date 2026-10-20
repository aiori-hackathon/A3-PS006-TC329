/**
 * Simulated replicas — the physical lab modelled in-process with the PS-006 timing model.
 *
 * Fidelity notes (docs/09-engineering-scope-definition.md):
 * - crash   → immediate connection refused (~0.3 ms)                     [reference: docker kill]
 * - linkloss→ connect timeout after 250 ms                               [reference: tc netem loss 100%]
 * - overload→ 2500 ms degrade vs 1500 ms health read timeout (READ_TIMEOUT)
 *             and 1000 ms upstream read timeout (probe 502)              [reference: /lab/degrade delay_ms:2500]
 * - weak TLS (max < 1.2) is refused by the STRICT data-path context
 *   (TLS_ERROR, as the reference spike observed: reset ≈ TLS error)
 *   but *visible* to the TOLERANT observer context (negotiated "1.1").
 * - untrusted_cert: simulated untrusted certificate (not signed by lab CA),
 *   rejected by strict data path (TLS_ERROR) and identified as R2_CERT_UNTRUSTED
 *   by the policy gate.
 * Timers are real: detection/downtime numbers emerge from actual scheduling.
 */

import type { FaultKind, HealthReason, Observation, ReplicaFacts, ReplicaId } from "./models";

export interface ProfileSpec {
  key: string;
  location: string; // declared /meta label
  cert: "in" | "eu" | "untrusted"; // which certificate the replica mounts
  tlsMin: string;
  tlsMax: string;
  logging: "minimal" | "verbose";
}

export const PROFILES: Record<string, ProfileSpec> = {
  compliant:       { key: "compliant",       location: "IN", cert: "in",        tlsMin: "1.2", tlsMax: "1.3", logging: "minimal" },
  weak_tls:        { key: "weak_tls",        location: "IN", cert: "in",        tlsMin: "1.1", tlsMax: "1.1", logging: "minimal" },
  eu_weak_tls:     { key: "eu_weak_tls",     location: "EU", cert: "eu",        tlsMin: "1.1", tlsMax: "1.1", logging: "minimal" },
  wrong_location:  { key: "wrong_location",  location: "EU", cert: "eu",        tlsMin: "1.2", tlsMax: "1.3", logging: "minimal" },
  label_mismatch:  { key: "label_mismatch",  location: "IN", cert: "eu",        tlsMin: "1.2", tlsMax: "1.3", logging: "minimal" },
  verbose_logging: { key: "verbose_logging", location: "IN", cert: "in",        tlsMin: "1.2", tlsMax: "1.3", logging: "verbose" },
  untrusted_cert:  { key: "untrusted_cert",  location: "IN", cert: "untrusted", tlsMin: "1.2", tlsMax: "1.3", logging: "minimal" },
};

export const PROFILE_KEYS = Object.keys(PROFILES) as string[];

const CERT_LABEL: Record<"in" | "eu" | "untrusted", string> = { in: "IN", eu: "EU", untrusted: "UNTRUSTED" };

export class ReplicaSim {
  readonly id: ReplicaId;
  profile: ProfileSpec;
  fault: FaultKind | null = null;
  degradedMs = 0;
  /** Wall ms until which a restarting replica refuses connections (crash cleanup). */
  restartingUntilMs = 0;

  constructor(id: ReplicaId, profileKey: string) {
    this.id = id;
    this.profile = PROFILES[profileKey] ?? PROFILES.compliant;
  }

  facts(): ReplicaFacts {
    return {
      id: this.id,
      profile: this.profile.key,
      location: this.profile.location,
      certLocation: CERT_LABEL[this.profile.cert],
      tlsMin: this.profile.tlsMin,
      tlsMax: this.profile.tlsMax,
      loggingClaim: this.profile.logging,
    };
  }

  get isRestarting(): boolean {
    return Date.now() < this.restartingUntilMs;
  }

  /** Health check through the STRICT data-path TLS context. */
  async healthCheck(cfg: {
    connectTimeoutMs: number;
    readTimeoutMs: number;
    latencyThresholdMs: number;
  }): Promise<{ ok: boolean; reason: HealthReason; latencyMs: number }> {
    const t0 = performance.now();
    const done = (ok: boolean, reason: HealthReason) => ({
      ok,
      reason,
      latencyMs: performance.now() - t0,
    });

    if (this.fault === "CRASH" || this.isRestarting) {
      return done(false, "CONNECT_REFUSED");
    }
    if (this.fault === "LINK_LOSS") {
      await sleep(cfg.connectTimeoutMs);
      return done(false, "CONNECT_TIMEOUT");
    }
    if (this.fault === "OVERLOAD") {
      const effective = Math.min(this.degradedMs, cfg.readTimeoutMs);
      await sleep(effective);
      if (this.degradedMs > cfg.readTimeoutMs) return done(false, "READ_TIMEOUT");
      if (effective > cfg.latencyThresholdMs) return done(false, "LATENCY_EXCEEDED");
      return done(true, "-");
    }
    await sleep(baseLatency());
    if (this.profile.cert === "untrusted" || tlsBelowDataPathMin(this.profile)) {
      return done(false, "TLS_ERROR"); // strict context refuses untrusted certs or weak TLS
    }
    return done(true, "-");
  }

  /** Client request proxied through the front door (strict context, upstream timeouts). */
  async dataPathRequest(cfg: {
    connectTimeoutMs: number;
    upstreamReadTimeoutMs: number;
  }): Promise<
    | { ok: true; latencyMs: number }
    | { ok: false; latencyMs: number; error: "conn_error" | "timeout" | "tls_error"; reason: HealthReason }
  > {
    const t0 = performance.now();
    if (this.fault === "CRASH" || this.isRestarting) {
      await sleep(0.4);
      return { ok: false, latencyMs: performance.now() - t0, error: "conn_error", reason: "CONNECT_REFUSED" };
    }
    if (this.fault === "LINK_LOSS") {
      await sleep(cfg.connectTimeoutMs);
      return { ok: false, latencyMs: performance.now() - t0, error: "timeout", reason: "CONNECT_TIMEOUT" };
    }
    if (this.fault === "OVERLOAD") {
      const effective = Math.min(this.degradedMs, cfg.upstreamReadTimeoutMs);
      await sleep(effective);
      return { ok: false, latencyMs: performance.now() - t0, error: "timeout", reason: "READ_TIMEOUT" };
    }
    await sleep(baseLatency());
    if (this.profile.cert === "untrusted" || tlsBelowDataPathMin(this.profile)) {
      return { ok: false, latencyMs: performance.now() - t0, error: "tls_error", reason: "TLS_ERROR" };
    }
    return { ok: true, latencyMs: performance.now() - t0 };
  }

  /**
   * Observation through the TOLERANT context (min TLS 1.0, ALL:@SECLEVEL=0):
   * weak servers are *seen*, not refused. Unreachable if the replica is down or
   * so degraded that /meta exceeds the decision timeout.
   */
  async tolerantView(): Promise<Observation> {
    const fail = (): Observation => ({
      replicaId: this.id,
      reachable: false,
      certTrusted: false,
      tlsVersion: null,
      declaredLocation: null,
      certLocation: null,
      declaredLogging: null,
      legacyAccepted: null,
    });

    if (this.fault === "CRASH" || this.isRestarting) {
      await sleep(0.5);
      return fail();
    }
    if (this.fault === "LINK_LOSS") {
      await sleep(200); // within the 500 ms decision budget
      return fail();
    }
    if (this.fault === "OVERLOAD") {
      await sleep(this.degradedMs); // 2500 ms > decision timeout ⇒ R1 (bounded by observer race)
      return fail();
    }

    await sleep(baseLatency() + 1.5); // handshake + GET /meta
    const isTrusted = this.profile.cert !== "untrusted";
    return {
      replicaId: this.id,
      reachable: true,
      certTrusted: isTrusted,
      tlsVersion: this.profile.tlsMax, // negotiated version = highest supported
      declaredLocation: this.profile.location,
      certLocation: CERT_LABEL[this.profile.cert],
      declaredLogging: this.profile.logging,
      legacyAccepted: null, // filled by the observer when the policy demands strict mode
    };
  }

  /** Versions below `minVersion` this replica still accepts (strict TLS mode check). */
  acceptsLegacyBelow(minVersion: string): string[] {
    const min = tuple(minVersion);
    const accepted: string[] = [];
    for (const v of ["1.0", "1.1", "1.2"]) {
      if (tuple(v) >= min) break;
      const lo = tuple(this.profile.tlsMin);
      const hi = tuple(this.profile.tlsMax);
      if (tuple(v) >= lo && tuple(v) <= hi) accepted.push(v);
    }
    return accepted;
  }
}

function tuple(v: string): [number, number] {
  const [a, b] = v.split(".").map((x) => parseInt(x, 10));
  return [a, b];
}

function tlsBelowDataPathMin(profile: ProfileSpec): boolean {
  return tuple(profile.tlsMax) < tuple("1.2");
}

function baseLatency(): number {
  return 2 + Math.random() * 4; // 2–6 ms, plain localhost jitter
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fault kind of the scenario's injector, mapped to audit reason codes. */
export function faultReason(fault: FaultKind): "FAULT_CRASH" | "FAULT_LINKLOSS" | "FAULT_OVERLOAD" {
  switch (fault) {
    case "CRASH":
      return "FAULT_CRASH";
    case "LINK_LOSS":
      return "FAULT_LINKLOSS";
    case "OVERLOAD":
      return "FAULT_OVERLOAD";
  }
}
