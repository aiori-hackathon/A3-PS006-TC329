# 12 — Testing Strategy

Per project instruction, **no test code is shipped in the repo**. Verification is therefore split into (a) runtime-verified safety properties computed from real evidence on every run, (b) a browser-based end-to-end runbook executed with the agent browser, and (c) static quality gates. The strategy mirrors the PS-006 test catalogue (`TS-U-*`, `TS-C-*`, `TS-I-*`, `TS-S-*`) but relocates the checks into the product itself.

---

## 1. Runtime-verified properties (checked by the scoring engine on every run)

These are not tests in a repo — they are invariants the app itself computes and displays; a violation is visible as a failed component and a capped grade.

| Property | Reference | Where enforced | Visible as |
|---|---|---|---|
| Policy determinism (same input → same decision, reason order fixed) | TS-U-08 | C6: recorded Observation re-evaluated 3× per gate | Run detail → determinism readout |
| Rule reason codes exact per profile | TS-U-01…07 | C2 vs the PRD matrix | Score component note |
| Safety: zero requests served by a FAIL replica | SI-1 / NFR-102 | C3 (per-run counter) | Footer counter, run row |
| Event order: PASS immediately before every route change | SI-2 | C4 (order check) | Chain + order badges |
| Audit chain integrity (tamper → detect) | TS-U-30/32 | C4 + `/api/audit/verify` | Verify button |
| Health thresholds (2 fail / 3 recover, passive kick) | TS-U-20/21 | Engine logic; observable in audit `health_changed` sequences | Audit tape |
| Downtime math (first fail → next success, ±probe interval) | TS-U-40…42 | `analyze.ts` (same algorithm as reference) | Downtime readout |
| Fail-closed shape of refusal outages | S3/S4 expectations | C5 | Outage-open flag |

## 2. Browser end-to-end runbook (agent-browser, executed after every significant change)

Golden paths — each must pass on the deployed dev server:

1. **Render:** `/` paints the console from `/api/lab/state` within ~2 s; no blank screen, no error boundary; footer sticks to viewport bottom; layout holds at 375 px and 1280 px.
2. **Failover path (S1 semantics by hand):** apply `compliant` B → inject CRASH on A → route diagram re-draws to B, epoch +1, audit tape shows `failure_detected → policy_evaluated PASS → failover_done`, probe strip shows a short red band then green, downtime readout appears.
3. **Refusal path (S4 semantics by hand):** apply `weak_tls` B (B must be standby; if B is active, reset first) → inject CRASH on A → mode UNAVAILABLE, red interlock cross on B's path with `R5_TLS_BELOW_MIN`, probe strip shows continuous 503s, footer `served-by-noncompliant = 0`.
4. **Recovery (S9 semantics by hand):** with service refused, clear the crash → A re-gates → `service_restored` on A, epoch +1, probe strip returns green.
5. **Scenario batch:** start S3 with 2 repeats → progress advances through phases → Records shows two completed runs with expected reasons `R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN`, chain ✓, scores and grades; manual fault injection is 409-locked during the batch and the UI shows the lock banner.
6. **Policy studio:** validate an invalid YAML (error shown, nothing changes) → reload a valid edited YAML → `policy_loaded` with new hash → verify a location decision changes accordingly.
7. **Records:** open a run detail sheet → timeline offsets, probe chart with outage band, C1–C6 breakdown, audit table; chain verify reports OK (and the tamper path is demonstrated by the API contract, not by editing production rows).
8. **Realtime resilience:** stop the bridge → console switches to POLLING lamp and keeps working; start bridge → LIVE LINK returns.

## 3. Static quality gates

- `bun run lint` clean (ESLint + Next rules) before reporting completion.
- TypeScript strict across engine and UI; shared types from doc 06 prevent contract drift.
- `dev.log` tailed after changes: no runtime exceptions, no failed API calls during the visit, no hydration warnings.

## 4. What a future test suite would cover (if tests are ever added)

Port of the reference catalogue to vitest: policy table tests (six profiles × pass/fail), chain tamper/delete tests, health tracker thresholds, analyzer fixtures (single outage, open outage, two outages, unsorted input, percentile ranks), and API integration tests over a seeded engine. The pure modules (`policy.ts`, `health.ts`, `audit.ts`, `analyze.ts`, `scoring.ts`) are structured to be testable with zero mocks.
