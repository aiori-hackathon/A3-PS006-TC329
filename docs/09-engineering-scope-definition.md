# 09 — Engineering Scope Definition

What this build is — and deliberately is not.

---

## In scope (built now)

**Engine (server, TypeScript)**
- Faithful port of the PS-006 reference design's *decision and measurement core*: policy engine (R1–R6, pure, deterministic, strict schema validation), health tracker (2/3 thresholds, passive signals), failover state machine (single route writer, epochs, sticky active, fail closed), allow-listed hash-chained audit log + verifier, downtime analyzer (outages, primary outage, percentiles), scoring engine.
- In-process **simulation** of the physical lab: two replicas with the six B-profiles, three fault types with the reference timing model (crash → immediate connect-refused; link loss → 250 ms connect timeout; overload → 2500 ms degrade vs 1000 ms threshold / 1500 ms read timeout), strict vs tolerant TLS contexts emulated at the decision level (a weak-TLS replica is *unhealthy to the data path* but *observable by the tolerant observer* — the two-context design of ADR-12).
- Real timers, real 50 ms absolute-schedule probe, real detection/failover/downtime numbers.
- Scenario sequencer S1–S9 with repeats, run lock, cancel; persistence of every run's evidence.

**API** — the 16 REST endpoints of doc 06; zod-validated bodies; structured errors.

**Realtime** — socket.io bridge mini-service (port 3033) + batched publish from the engine; client store with REST-snapshot fallback.

**Frontend** — the single-route console (Console / Scenarios / Policy / Records), signal-box design system, responsive, accessible, reduced-motion aware.

## Out of scope (by design — and why)

| Excluded | Why |
|---|---|
| Real Docker containers, real TLS handshakes, real `tc netem` | The sandbox runs one Node/Bun process per service; the reference repo already owns the container path. The simulation reproduces the *observable* behaviour and timing model so the console demonstrates the identical logic. |
| DNS/anycast failover, session migration, controller HA | Non-goals inherited from the PS-006 brief. |
| Authentication, multi-tenancy, rate limiting | Single-operator demonstrator; admin plane is the whole point of the UI. |
| Geolocation / legal compliance logic | Location is a configured, certificate-attested label — stated openly in the UI. |
| Load generation (real CPU pressure) | Overload uses the deterministic degrade variant (the reference doc's own headline recommendation). |
| Test code in the repo | Project instruction: no test files shipped. Verification is runtime + browser-based (doc 12). |

## Fidelity contract (what "simulated" means precisely)

| Aspect | Fidelity |
|---|---|
| Policy decisions & reason codes | Exact port of the reference `evaluate()` — identical semantics, ordering, short-circuits |
| Audit schema & chain | Byte-compatible JSONL rows; same canonical-hash rule; same verifier semantics |
| State machine transitions | Same modes, same event order (SI-2), same sticky-active rule |
| Timing model | Same defaults (100 ms checks, 250/1500/1000 ms timeouts, 2/3 thresholds, 50 ms probe); numbers emerge from real scheduling |
| Health reason classification | Same taxonomy (CONNECT_REFUSED, CONNECT_TIMEOUT, READ_TIMEOUT, LATENCY_EXCEEDED, TLS_ERROR, HTTP_STATUS) |
| TLS 1.1 "handshake" | Modelled as the reference spike *observed it*: tolerant observer sees `1.1`; strict data path sees a reset → CONNECT_ERROR/TLS_ERROR |
| Downtime math | Same algorithm as `probe/analyze.py` (first fail → next success, ±probe interval) |

Anything not in this table that a production deployment would need (real sockets, real certs, real processes) belongs to the upstream PS-006 repository, not this console.
