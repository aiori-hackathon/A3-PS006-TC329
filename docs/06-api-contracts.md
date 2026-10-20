# 06 — API Contracts

All REST endpoints are Next.js App Router route handlers under `/api`. JSON bodies; errors as `{ "error": "machine_code", "message": "human text" }`. A scenario batch in flight sets a **run lock**: mutating endpoints reply `409 {"error":"run_locked"}`.

Shared enums:

- `event`: `controller_started`, `policy_loaded`, `policy_load_failed`, `health_changed`, `failure_detected`, `policy_evaluated`, `failover_done`, `failover_refused`, `service_unavailable`, `service_restored`, `admin_switch_requested`, `fault_injected`, `fault_cleared`
- `decision`: `HEALTHY`, `UNHEALTHY`, `PASS`, `FAIL`, `SWITCHED`, `REFUSED`, `UP`, `DOWN`, `-`
- reason codes: `R1_UNREACHABLE`, `R2_CERT_UNTRUSTED`, `R3_LOCATION_NOT_ALLOWED`, `R4_LABEL_CERT_MISMATCH`, `R5_TLS_BELOW_MIN`, `R6_LOGGING_NOT_MINIMAL`, health reasons (`CONNECT_REFUSED`, `CONNECT_TIMEOUT`, `READ_TIMEOUT`, `LATENCY_EXCEEDED`, `TLS_ERROR`, `HTTP_STATUS`), fault reasons (`FAULT_CRASH`, `FAULT_LINKLOSS`, `FAULT_OVERLOAD`) — joined with `+` when multiple.

---

## REST

### GET /api/lab/state
Full snapshot (drives the console on load and on polling fallback).
```json
{
  "runId": "live-0", "mode": "SERVING", "active": "A", "epoch": 0,
  "runLock": false, "startedAt": "2026-10-20T…Z",
  "policy": { "id": "lab-policy-001", "sha": "9f2c1a7be340", "minVersion": "1.2",
              "enforcement": "negotiated", "allowedLocations": ["IN"],
              "requireCertLabelMatch": true, "requireMinimalLogging": true },
  "controller": { "healthIntervalMs": 100, "connectTimeoutMs": 250, "readTimeoutMs": 1500,
                  "latencyThresholdMs": 1000, "failureThreshold": 2, "recoveryThreshold": 3,
                  "decisionTimeoutMs": 500, "probeIntervalMs": 50, "idleProbeIntervalMs": 200 },
  "replicas": [ { "id": "A", "profile": "compliant", "location": "IN", "certLocation": "IN",
                  "tlsMin": "1.2", "tlsMax": "1.3", "loggingClaim": "minimal",
                  "health": "HEALTHY", "lastReason": "-", "lastLatencyMs": 3.2,
                  "consecutiveFails": 0, "fault": null,
                  "lastDecision": { "passed": true, "reasons": [], "atIso": "…" } } ],
  "recentAudit": [ /* AuditEvent, last 60 */ ],
  "recentProbe": [ /* ProbeResult, last 160 */ ],
  "probeStats": { "intervalMs": 200, "okRate": 1.0, "lastDowntimeMs": null },
  "scenarioStatus": { "running": false }
}
```

### POST /api/lab/fault
`{ "replica": "A"|"B", "fault": "CRASH"|"LINK_LOSS"|"OVERLOAD", "action": "inject"|"clear" }`
→ `200 { "ok": true }` · `400` invalid body · `409` run_locked · `503` if clearing a fault that is not active.

### POST /api/lab/profile
`{ "replica": "B", "profile": "weak_tls" }`
→ `200 { "ok": true, "applied": "weak_tls" }` · `409` run_locked or `replica_active` (B currently serving — profile change requires standby).

### POST /api/lab/switch
`{ "to": "B" }` — manual switch, passes the same policy gate.
→ `200 { "result": "SWITCHED", "epoch": 3, "decision": {…} }`
→ `200 { "result": "REFUSED", "reasons": ["R5_TLS_BELOW_MIN"], "decision": {…} }` (expected outcome, not an error)
→ `400` invalid target · `409` run_locked.

### POST /api/lab/reset
`{}` → `200 { "ok": true, "runId": "live-1" }` — clears faults, re-gates A as initial active, opens a fresh audit chain, epoch 0. `409` run_locked.

### GET /api/policy
→ `{ "yaml": "…", "parsed": { …same fields as state.policy }, "sha": "9f2c1a7be340", "history": [ { "sha": "…", "atIso": "…", "ok": true } ] }`

### POST /api/policy/validate
`{ "yaml": "…" }` → `200 { "valid": true, "parsed": {…}, "sha": "…" }` or `200 { "valid": false, "error": "tls.min_version must be one of 1.0,1.1,1.2,1.3" }` (validation is data, never a 4xx).

### POST /api/policy/reload
`{ "yaml": "…" }` → `200 { "ok": true, "sha": "…", "parsed": {…} }` or `200 { "ok": false, "error": "…" }` — on failure the previous policy stays active and `policy_load_failed` is audited. `409` run_locked.

### GET /api/audit?runId=S1-r02-9f31&limit=200
→ `{ "events": [AuditEvent…], "runIds": ["live-1", "S1-r02-9f31", …] }` — `runIds` lists the 12 most recent run ids for the selector. No `runId` → newest run.

### GET /api/audit/verify?runId=S1-r02-9f31
→ `{ "ok": true, "problemLine": null, "message": "ok", "count": 47 }`
→ `{ "ok": false, "problemLine": 3, "message": "hash mismatch", "count": 47 }`

### GET /api/runs?limit=50&scenario=S1
→ `{ "runs": [RunSummary…] }` (id, scenario, repeat, bProfile, fault, expect, outcome, reasons, downtimeMs, detectMs, decideMs, switchMs, scoreTotal, grade, auditChainOk, servedByNoncompliant, status, startedAt, endedAt).

### GET /api/runs/{runId}
→ `{ "run": {…full}, "score": { "total": 92, "grade": "A", "components": [{ "key": "C1", "label": "…", "points": 20, "maxPoints": 20, "note": "…" }] }, "audit": [AuditEvent…], "timeline": [ { "offsetMs": 0, "event": "fault_injected", "replica": "A", "decision": "-", "reason": "FAULT_CRASH", "tsIso": "…" } ], "probe": [ProbeRecord… downsampled ≤ 600 points] }` · `404` unknown run.

### GET /api/analytics/matrix
→ `{ "scenarios": [ { "key": "S1", "fault": "crash", "bProfile": "compliant", "expect": "FAILOVER",
    "runs": 10, "passRate": 1.0, "downtime": { "count": 10, "mean": 213, "p50": 200, "p95": 300, "min": 150, "max": 350 },
    "meanDetectMs": 182, "meanScore": 97, "bestGrade": "A+", "violations": 0 } ] }`

### POST /api/scenario/start
`{ "scenario": "S3", "repeats": 3 }` → `200 { "ok": true, "batchId": "b-…" }` · `409` if a batch is already running · `400` unknown scenario/repeats out of 1–10.

### GET /api/scenario/status
→ `{ "running": true, "scenario": "S3", "repeat": 2, "repeats": 3, "phase": "OBSERVE",
     "phaseStartedIso": "…", "runId": "S3-r02-…", "progress": 0.42, "lastSummary": {…}, "batchId": "b-…" }`
or `{ "running": false, "lastBatch": { "scenario": "S3", "repeats": 3, "completedAt": "…", "summaries": […] } }`

### POST /api/scenario/cancel
`{}` → `200 { "ok": true }` — stops after the current repeat finishes its analyze step (clean state guaranteed).

---

## WebSocket (channel `lab`)

Connect: `io("/?XTransformPort=3033", { transports: ["websocket","polling"] })` — never an absolute host. Messages arrive batched: `socket.on("lab", ({ events }) => …)` with `events: LabEvent[]`:

| type | payload |
|---|---|
| `state` | `{ mode, active, epoch, runId, runLock }` |
| `audit` | AuditEvent (chain fields included) |
| `probe` | `{ seq, tSendNs, tRecvNs, status, ok, latencyMs, servedBy, epoch, error }` |
| `health` | `{ replica, ok, reason, latencyMs, health, consecutiveFails, atNs }` |
| `fault` | `{ replica, fault, action }` |
| `policy` | `{ event: "loaded"\|"load_failed"\|"validated", sha, id, error? }` |
| `run` | scenario progress (same shape as GET /api/scenario/status payload core) + `lastSummary` when a repeat completes |

Recovery: on `connect` or after a > 5 s gap, the client re-fetches `/api/lab/state`; the socket stream only needs to be *eventually* consistent, the REST snapshot is authoritative.
