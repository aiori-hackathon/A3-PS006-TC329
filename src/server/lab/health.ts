/**
 * Health tracker — pure state machine port of PS-006 `controller/app/health.py`.
 * failureThreshold consecutive failures ⇒ UNHEALTHY; recoveryThreshold successes ⇒ HEALTHY.
 */

import type { HealthReason, HealthState } from "./models";

export class HealthTracker {
  readonly failureThreshold: number;
  readonly recoveryThreshold: number;
  state: HealthState = "UNKNOWN";
  consecutiveFail = 0;
  consecutiveOk = 0;
  lastReason: HealthReason = "-";

  constructor(failureThreshold = 2, recoveryThreshold = 3) {
    this.failureThreshold = failureThreshold;
    this.recoveryThreshold = recoveryThreshold;
  }

  /** Returns the new state only when it changed, else null. */
  private apply(): HealthState | null {
    const old = this.state;
    if (
      (this.state === "UNKNOWN" || this.state === "HEALTHY") &&
      this.consecutiveFail >= this.failureThreshold
    ) {
      this.state = "UNHEALTHY";
    } else if (this.state === "UNKNOWN" && this.consecutiveOk >= 1) {
      this.state = "HEALTHY";
    } else if (this.state === "UNHEALTHY" && this.consecutiveOk >= this.recoveryThreshold) {
      this.state = "HEALTHY";
    }
    return this.state !== old ? this.state : null;
  }

  onResult(ok: boolean, reason: HealthReason = "-"): HealthState | null {
    if (ok) {
      this.consecutiveOk += 1;
      this.consecutiveFail = 0;
    } else {
      this.consecutiveFail += 1;
      this.consecutiveOk = 0;
      this.lastReason = reason;
    }
    return this.apply();
  }

  /** A failed proxied request counts as one failure signal (passive detection). */
  onPassiveFailure(reason: HealthReason): HealthState | null {
    return this.onResult(false, reason);
  }

  reset(): void {
    this.state = "UNKNOWN";
    this.consecutiveFail = 0;
    this.consecutiveOk = 0;
    this.lastReason = "-";
  }
}
