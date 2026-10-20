# 02 — User Stories and Acceptance Criteria

Format: **Given / When / Then**. Story IDs map to requirement IDs in `01-product-requirements.md`.

---

## Console

### US-1 Watch the route (FR-101)
As a mentor, I want to see the current traffic route at a glance, so I never have to guess which replica is serving.
- **Given** the lab is serving on Replica A, **when** I open the console, **then** the route diagram shows a solid, animated path Probe → Controller → A, A carries an "ACTIVE" plate, and the epoch counter reads the current epoch.
- **Given** the controller is in UNAVAILABLE, **when** I look at the diagram, **then** both replica paths are dashed/greyed and a red interlock cross is shown with the last refusal reason codes.

### US-2 Inject a crash (FR-102, FR-104)
As a mentor, I want to crash the active replica and watch the controller react.
- **Given** A is active and B is `compliant`, **when** I press "Crash" on A, **then** within ~1 s the audit tape shows `failure_detected (A, UNHEALTHY, CONNECT_REFUSED)`, `policy_evaluated (B, PASS)`, `failover_done (B, SWITCHED)`, the route re-draws to B, and the epoch increments.
- **Given** the same setup, **when** the probe strip is watched, **then** failed ticks appear (502/503) for a short window and then green ticks resume; the live downtime readout shows the outage length with ±50 ms resolution noted.

### US-3 See a refusal with reason codes (FR-104)
As a mentor, I want traffic to be *refused* by a non-compliant replica, with the exact rules that failed.
- **Given** A is active and B is `eu_weak_tls`, **when** I crash A, **then** the audit tape shows `policy_evaluated (B, FAIL, R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN)` and `failover_refused (B, REFUSED)`, the controller enters UNAVAILABLE, the diagram marks B's path with a red interlock cross, and the probe strip shows 503s for every request.
- **Given** that state, **when** I check the served-by counter, **then** the number of requests served by B is 0.

### US-4 Manual switch is still gated (FR-105)
As an operator, my manual switch must pass the same gate.
- **Given** B is `weak_tls`, **when** I request a manual switch to B while serving on A, **then** I see a refusal result with `R5_TLS_BELOW_MIN` and traffic stays on A (or stays fail-closed).
- **Given** B is `compliant` and healthy, **when** I request a switch to B, **then** the epoch increments and B becomes active.

### US-5 Change Replica B's profile (FR-103)
As a demonstrator, I want to pick B's profile to set up a scenario.
- **Given** B is standby, **when** I apply a profile, **then** B's card updates its label / TLS range / logging claim, a `health_changed` cycle shows B returning healthy, and the profile change is auditable.
- **Given** B is currently **active**, **when** I try to change its profile, **then** the request is rejected with a clear message (a profile change recreates the replica; only a standby can be recreated).

## Scenarios

### US-6 Run the headline demo in one click (FR-108)
As a demonstrator, I want to run S1/S2/S3 back-to-back with N repeats without touching anything else.
- **Given** the console is idle, **when** I start S3 with 3 repeats, **then** the runner shows live phase (reset → warmup → fault → observe → cleanup → analyze → score), a progress readout, and afterwards each repeat appears in Records with its outcome, reason codes, downtime and score.
- **Given** a batch is running, **when** I try to inject a fault manually, **then** the API answers 409 and the console shows "Scenario batch running — manual changes locked".

### US-7 Read the matrix (FR-108, FR-109)
As a report reader, I want per-scenario statistics.
- **Given** several completed runs, **when** I open the Scenarios board, **then** each scenario card shows runs, pass rate, downtime mean/p50/p95/min/max, mean detection time, best grade, and the invariant "0 requests to non-compliant replicas".

## Policy

### US-8 Edit and validate the policy (FR-111)
- **Given** I paste a policy with `min_version: "9.9"`, **when** I press Validate, **then** I see a precise error and the active policy is unchanged.
- **Given** a valid policy with `allowed_locations: [IN, EU]`, **when** I reload it, **then** the audit tape shows `policy_loaded` with a new 12-hex policy hash, and a following evaluation of an EU replica passes R3.

### US-9 Reload safety (FR-105)
- **Given** an invalid YAML, **when** I reload, **then** the response says the reload failed, the audit tape shows `policy_load_failed`, and the previous policy keeps serving.

## Records & audit

### US-10 Verify the audit chain (FR-106)
As a reviewer, I want tamper evidence.
- **Given** any completed run, **when** I press "Verify chain", **then** the verifier reports OK with the line count, or reports the first broken line with a reason if the file was edited.

### US-11 Inspect a run (FR-110)
- **Given** a completed run, **when** I open its detail, **then** I see the merged timeline (offsets from the fault), the probe chart with the outage marked, the score breakdown (C1–C6), and the raw audit rows.

## Resilience

### US-12 Realtime fallback (FR-112, NFR-107)
- **Given** the bridge is down, **when** I use the console, **then** a "live link down" lamp shows and the console keeps working by polling `/api/lab/state`.

### US-13 Accessibility & motion
- **Given** `prefers-reduced-motion`, **when** I use the console, **then** route animations and pulses are disabled; all controls are keyboard reachable with a visible ink focus ring.
