# 08 — Scoring Engine Specification

Every scenario run is scored 0–100 immediately after analysis. Scores are deterministic functions of the run's evidence (audit events, probe records, policy decisions) — never of wall-clock luck beyond what the evidence itself records. Components are persisted (`ScoreComponent`) and shown in the run detail.

---

## Components

| Key | Name | Max | Pass condition |
|---|---|---|---|
| C1 | Outcome correctness | 20 | Realized outcome equals the scenario's expected outcome (`FAILOVER` / `REFUSED` / `RESTORED`) |
| C2 | Reason codes | 10 | For refusals: reason set equals the PRD matrix exactly (e.g. S3 → `R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN`); for failovers: no reason codes |
| C3 | Safety invariant | 20 | `servedByNoncompliant == 0` (no probe response was ever served by a replica whose latest evaluation was FAIL) |
| C4 | Audit integrity | 20 | Chain verifies (12) **and** event order valid (8): every route change immediately preceded by `policy_evaluated PASS`; `failure_detected` before `policy_evaluated` before `failover_done/refused` |
| C5 | Responsiveness | 20 | Budget by fault type (below); for refusals: time from fault to `failover_refused` ≤ 2500 ms and the outage stayed fail-closed (no traffic until cleanup / end of window) |
| C6 | Determinism replay | 10 | The gate's recorded Observation re-evaluated 3× reproduces the audited decision, reasons in the same order |

## Downtime budgets (C5, FAILOVER / RESTORED outcomes)

| Fault | Budget (full 20 pts) | Floor (0 pts) | Rationale (PS-006 timing model) |
|---|---|---|---|
| crash | ≤ 1500 ms | ≥ 4500 ms | passive detection + 2×100 ms checks ≈ 0.1–0.3 s |
| linkloss | ≤ 2500 ms | ≥ 7500 ms | 2 × connect-timeout 250 ms + probe quantization |
| overload | ≤ 4500 ms | ≥ 13500 ms | 2 × read-timeout 1.5 s dominates |
| restored (S9) | ≤ 8000 ms | ≥ 24000 ms | includes the scheduled +6 s recovery window |

Linear interpolation between budget and floor; rounded to 0.1. Example: crash outage 1500 ms → 20 pts; 3000 ms → 20 × (1 − (3000−1500)/3000) = 10 pts.

## Refusal runs (C5)

- 10 pts: `t(refusal event) − t(fault_injected) ≤ 2500 ms`.
- 10 pts: every probe between refusal and cleanup answered 503 (fail-closed sustained; `servedByNoncompliant` stays 0 — C3 would already zero on a leak, this component checks the *shape* of the outage: open until the run window ends or the replica recovers, never "accidentally" green).

## Grades

| Grade | Total |
|---|---|
| A+ | ≥ 97 |
| A | ≥ 90 |
| B | ≥ 80 |
| C | ≥ 70 |
| D | < 70 |

A run with a C3 violation is capped at grade **D** regardless of total (safety outranks everything — mirrors the fail-closed philosophy).

## Aggregation

- Per scenario across repeats: pass rate (expected outcome + expected reasons), downtime mean/p50/p95/min/max, mean detect/decide/switch, mean score, best grade, violations count.
- The Scenarios board and Records matrix read the same aggregation endpoint (`/api/analytics/matrix`) so numbers can never disagree.

## Evidence & Cryptographic Verification Invariants

### C4: Persisted Cryptographic Audit Verification
- Scoring for C4 is executed strictly against **durable database rows** retrieved via `engine.getPersistedAudit(runId)` after an explicit `await engine.flushAuditPersistence()`.
- The audit verifier (`verifyChain`) independently verifies:
  1. **Canonical JSON serialization** where dictionary keys are lexicographically sorted prior to hashing (`sortCanonical`).
  2. **Timestamp normalization** ensuring both ISO strings and SQLite Date representations serialize canonically.
  3. **Genesis linkage** where the initial event links from `GENESIS`.
  4. **Strict monotonic sequencing** (`seq` increments by 1 with no gaps or duplications).
  5. **SHA-256 hash chaining** where each record's `hash = sha256(canonicalPayload + prevHash)`.
- If any cryptographic defect, altered field, deleted row, or broken link is detected, C4 is docked 12 points, and subsequent verification flags are marked in run evidence.
- Order validity (8 pts) verifies that every `failover_done` or `route_switched` was preceded by a valid `policy_evaluated PASS` decision for the target replica, preserving SI-1.

### C6: Deterministic Replay Contract
- `observationJson` stored on each `Run` row captures the snapshot of candidate replica facts observed by the gate at decision time, the active policy snapshot, and the evaluated decision.
- During scoring, `scoreRun` reconstructs the policy and observation from the persisted JSON and invokes `evaluatePolicy(policy, obs)` three consecutive times.
- Determinism requires that all 3 replays strictly equal the audited outcome:
  `r.passed === auditedPassed && r.reasons.join("+") === auditedReasons.join("+")`.
- If any replay diverges, C6 is awarded 0 points.

### C3: Safety Invariant & Grade Clamping
- `servedByNoncompliant` tracks the number of probe requests served by any candidate replica whose gate decision failed compliance.
- If `servedByNoncompliant > 0`, C3 is awarded 0 points, and the final grade is unconditionally clamped to **D**, regardless of the overall score total.

