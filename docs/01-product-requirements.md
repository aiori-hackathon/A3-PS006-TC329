# 01 — Product Requirements

**Product:** INTERLOCK — Policy-Constrained Failover Control Room
**Project:** PS-006 demonstrator (team Algo-Ancesstors, `A3-PS006-TC329`)
**Version:** 1.0 · **Status:** Implemented baseline

---

## 1. Purpose

Ordinary failover answers one question: *is another replica reachable?* INTERLOCK is the web console for a failover controller that refuses to answer only that question. It runs the PS-006 lab — two replicas behind a reverse-proxy controller — in the browser: operators inject failures, watch the deterministic policy gate (location label, TLS baseline, certificate trust, logging claim) approve or refuse every route change, and read a tamper-evident audit timeline with measured downtime.

The lab is **simulated in-process on the server** (one engine per app instance) with the same timing model, state machine, and schemas as the Docker reference design: detection times, downtime numbers and audit orderings emerge from real timers and real 50 ms probe scheduling, not from scripted outcomes.

## 2. Users

| User | Needs |
|---|---|
| Mentor / evaluator | Verify the policy gate works: inject a fault, see traffic move only to a compliant replica, see refusals with exact reason codes |
| Demonstrator | One-click scenarios S1–S9, live timeline, downtime numbers, scores |
| Technical reader | Audit chain verification, policy determinism, safety invariant evidence (zero requests to non-compliant replicas) |

## 3. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-101 | Live console: topology (probe → controller → Replica A/B), controller state machine (STARTING/SERVING/EVALUATING/UNAVAILABLE), active replica, epoch counter | Must |
| FR-102 | Fault injection on either replica: process crash, link loss, overload (deterministic degrade); inject + clear; events `fault_injected` / `fault_cleared` | Must |
| FR-103 | Replica B selectable profiles: `compliant`, `weak_tls`, `eu_weak_tls`, `wrong_location`, `label_mismatch`, `verbose_logging` | Must |
| FR-104 | Policy gate on every route change; refusal returns reason codes R1–R6; fail closed (503 to clients) when no compliant healthy replica exists | Must |
| FR-105 | Manual switch request (still policy-gated); policy reload without restart (invalid reload keeps the previous policy) | Must |
| FR-106 | Hash-chained audit log (JSONL schema of PS-006: seq, ts, run_id, event, replica, decision, reason, policy, prev, hash) with field allow-list; chain verifier exposed in the UI | Must |
| FR-107 | Continuous probe (1 request / 50 ms during runs, 200 ms idle), live strip chart, downtime computed from first failed request to first success | Must |
| FR-108 | Scenario runner for S1–S9 with repeats (1–10), live progress, per-run summaries and per-scenario aggregates (mean, p50, p95, min, max) | Must |
| FR-109 | Scoring engine: 0–100 score per run (outcome, reason codes, safety, integrity, responsiveness, determinism) with grade and component breakdown | Must |
| FR-110 | Records view: run history, run detail (timeline with deltas, probe chart, score breakdown, audit table, chain verify) | Must |
| FR-111 | Policy Studio: YAML editor, live validation, parsed-rule summary, reload | Must |
| FR-112 | Realtime push of state, health, probe, audit and run events over socket.io (bridge service, port 3033) with REST snapshot fallback | Must |
| FR-113 | Run lock: while a scenario batch is running, manual mutations (faults, profile, policy reload, switch, reset) are rejected with 409 | Must |
| FR-114 | Responsive layout (mobile → desktop), accessible controls, reduced-motion respected | Must |

## 4. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-101 | Policy evaluation is pure and deterministic — same (policy, observation) always yields the same decision and reason order |
| NFR-102 | Safety invariant: zero requests ever served by a replica whose latest evaluation was FAIL |
| NFR-103 | Audit integrity: SHA-256 hash chain; any edited/deleted line is detected by the verifier |
| NFR-104 | Privacy: audit fields are allow-listed; no client identifiers, paths or payloads are logged |
| NFR-105 | Realtime: state, audit and probe events reach the browser within ~250 ms |
| NFR-106 | UI stays responsive with 20 probes/s + 20 health checks/s streaming |
| NFR-107 | Failure of the realtime bridge degrades to polling, never breaks the console |
| NFR-108 | Measurement honesty: downtime resolution equals the probe interval; stated in the UI (±50 ms) |

## 5. Success metrics

- 100 % of compliant-target scenarios (S1, S2, S6) fail over; 100 % of refusal scenarios (S3–S5, S7, S8) refuse with the exact reason codes from the PRD matrix.
- `servedByNoncompliant == 0` in every run; audit chain verifies in every run.
- Every `failover_done` / `service_restored` is immediately preceded by `policy_evaluated PASS`.
- Downtime reported per scenario as mean, p50, p95, min, max with the ±50 ms resolution note.

## 6. Honest limits (shown in the UI footer / About)

The lab simulates replicas inside one server process. Location labels are configured, certificate-attested claims — **not** geolocation; there is no Internet-path residency guarantee. This is a demonstrator, not a production traffic manager and not a legal compliance engine.
