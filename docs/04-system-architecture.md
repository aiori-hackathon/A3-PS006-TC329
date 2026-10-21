# 04 — System Architecture

---

## 1. Runtime topology

Three processes cooperate; the browser only ever talks to the gateway (relative paths).

```
┌ Browser ──────────────────────────────────────────────────────┐
│  page.tsx (client)                                            │
│   ├── REST: /api/...            (gateway → Next.js :3000)      │
│   └── WS:  io("/?XTransformPort=3033")  (gateway → bridge :3033)│
└───────────────────────────────────────────────────────────────┘
        │                          │
┌──────▼───────────────────────┐  ┌▼─────────────────────────────┐
│ Next.js server (port 3000)  │  │ realtime bridge (port 3033)    │
│  App Router route handlers  │  │  socket.io, path "/"           │
│  ┌────────────────────────┐ │  │  POST /publish (token)        │
│  │ INTERLOCK ENGINE       │─┼──▶ batches events every ~40 ms   │
│  │ (singleton, timers)    │ │   fire-and-forget, 500 ms timeout │
│  │ policy·audit·monitor·  │ │  │                                │
│  │ manager·probe·runner·  │ │  │ broadcasts on channel "lab"     │
│  │ scoring                │ │  └────────────────────────────────┘
│  └───────────┬────────────┘ │
│  Prisma ─────▼ SQLite (db/custom.db)                           │
└───────────────────────────────────────────────────────────────┘
```

- **Engine** lives inside the Next.js server process as a `globalThis` singleton (survives dev HMR). All commands (faults, switches, policy, scenarios) go through Next.js REST routes, which mutate the engine directly — no cross-process state.
- **Bridge** is a stateless socket.io fan-out. The engine pushes batched events to `POST http://127.0.0.1:3033/publish` (server-to-server; never through the gateway) with a shared token. If the bridge is down, publishing fails silently and clients fall back to REST polling.
- **Persistence** is append-only: audit events, probe records, runs and score components go to SQLite via Prisma.

## 2. Engine modules (`src/server/lab/`)

| Module | Role | Purity |
|---|---|---|
| `models.ts` | Types: Health, Mode, RouteTable, Observation, Decision, ProbeResult, HealthTick, AuditEvent | — |
| `policy.ts` | YAML parse/validate (strict keys), SHA-256 12-hex hash, `evaluate()` — rules R1–R6 in fixed order, all failures reported | pure |
| `health.ts` | HealthTracker: failure_threshold=2, recovery_threshold=3, passive failure counts | pure |
| `audit.ts` | Allow-listed events, seq, SHA-256 chain (`hash = SHA256(prev ‖ canonical(body))`), verifier, in-memory ring + Prisma sink | pure + sink |
| `replicas.ts` | Simulated replicas: profiles table, fault state (CRASH / LINK_LOSS / OVERLOAD), latency model, strict vs tolerant "TLS handshake" outcomes, `/meta` facts | — |
| `observer.ts` | `observe(replica)` → Observation (legacy-tolerant context): reachable, certTrusted, tlsVersion, declared/cert location, logging claim, legacyAccepted | I/O boundary |
| `monitor.ts` | Two check loops (100 ms), classification (CONNECT_REFUSED, CONNECT_TIMEOUT, READ_TIMEOUT, LATENCY_EXCEEDED, TLS_ERROR, HTTP_STATUS), passive-signal kick | timers |
| `manager.ts` | FailoverManager event consumer: the **only** writer of the route table; gate → policy_evaluated audit; failover_done / failover_refused / service_restored; sticky active; reevaluate tick while UNAVAILABLE | serialized |
| `probe.ts` | Front-door + probe scheduler: absolute 50 ms/200 ms schedule (no drift), route-aware request simulation, passive failure signalling, ring buffer, run-scoped record capture | timers |
| `analyze.ts` | Outage finder (first fail → next success), primary outage after fault ts, mean/p50/p95/min/max | pure |
| `scoring.ts` | C1–C6 component scoring, grades A+…D (see doc 08) | pure |
| `runner.ts` | Scenario batch sequencer: per repeat — reset, profile apply, warmup 3 s, probe on, fault inject at t0, observe 12 s (S9: restore at +6 s), cleanup, analyze, score, persist | timers |
| `engine.ts` | Singleton wiring, run lock, event publisher (batched bridge POST), snapshot builder, Prisma writes | — |

## 3. Failover sequence (engine, mirrors PS-006 System Design 5.4)

```
active becomes UNHEALTHY (2 consecutive fails or passive signal + immediate check)
  → audit failure_detected
  → mode EVALUATING
  → observe(candidate)  (tolerant context; untrusted cert ⇒ no /meta read)
  → evaluate(policy, obs) → audit policy_evaluated
  → PASS && candidate HEALTHY
        → route := {SERVING, candidate}, epoch += 1
        → audit failover_done
  → else audit failover_refused (+ reason codes)
        → route := {UNAVAILABLE, null}; audit service_unavailable  (fail closed)
recovery: while UNAVAILABLE, a HEALTHY replica re-gates every 2 s;
PASS ⇒ service_restored, epoch += 1. Sticky active: no automatic failback.
```

Safety invariant: the probe's front door reads the immutable RouteTable snapshot; a replica whose latest decision was FAIL never appears as `servedBy`, and UNAVAILABLE answers 503 `no_compliant_replica` — enforced by construction and counted per run.

## 4. Determinism & concurrency rules

- `evaluate()` touches no clock, randomness, network or env. Reason codes are emitted in rule order (R1 short-circuits, R2 short-circuits, R3→R6 accumulate).
- TLS versions compare as numeric tuples; unknown/missing data always fails its rule.
- One serialized manager loop (async event queue) — exactly one route writer; the RouteTable is an immutable object swapped atomically.
- Probe uses an absolute-time schedule (`start + k·interval`), so timestamps never drift; wall-clock `Date.now()` for records, `performance.now()` for durations.
- Timers cleared and re-created deterministically on run reset; a run lock (FR-113) makes scenario batches the only mutator while active.

## 5. Realtime bridge protocol (port 3033)

- socket.io server, `path: "/"`, CORS `*` (gateway terminates anyway), ping 25 s / timeout 60 s.
- `POST /publish` with header `x-lab-token` (env `REALTIME_TOKEN`, default dev token) and body `{ "events": [{ "type": "state"|"audit"|"probe"|"health"|"run"|"fault"|"policy", "payload": … }] }` → broadcasts one `lab` message `{ events: [...] }`.
- Clients treat WS as progressive enhancement: on connect or on any gap > 5 s they re-pull `/api/lab/state`.

## 6. Failure-mode matrix

| Failure | Response |
|---|---|
| Bridge down | Publisher swallows errors; console shows POLLING lamp |
| Prisma write fails | Engine keeps serving; run marked `status=DEGRADED` if a run is in flight |
| Invalid policy reload | Previous policy kept; `policy_load_failed` audited |
| Unknown replica / fault in request | 400 with message; nothing audited |
| Scenario already running (manual mutation) | 409 `run_locked` |
| Manager throws unexpectedly | Fail closed to UNAVAILABLE, loops keep running |
