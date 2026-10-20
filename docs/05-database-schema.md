# 05 — Database Schema

SQLite via Prisma (`db/custom.db`). Append-heavy: the engine inserts audit events and probe records as they happen; runs and score components are written at run completion. See `prisma/schema.prisma`.

---

## Entity model

```
PolicyFile 1 ── (referenced by sha) ── * AuditEvent(policy field) — denormalized hash only
Run 1 ── * AuditEvent(runId)      Run 1 ── * ProbeRecord(runId)     Run 1 ── * ScoreComponent(runId)
```

## Tables

### PolicyFile
| Column | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| sha | String @unique | first 12 hex of SHA-256 of YAML text |
| yaml | String | exact loaded text |
| parsedJson | String | serialized parsed summary (id, locations, tls, flags) |
| active | Boolean | one active row |
| createdAt | DateTime | |

### Run
| Column | Type | Notes |
|---|---|---|
| id | String PK | run id, e.g. `S1-r02-9f31` (scenario, repeat, suffix) |
| batchId | String | groups repeats started together |
| scenario | String | `S1`…`S9` |
| repeat | Int | 1-based |
| fault | String | `crash` / `linkloss` / `overload` |
| bProfile | String | Replica B profile key |
| expect | String | `FAILOVER` / `REFUSED` / `RESTORED` |
| status | String | `RUNNING` / `COMPLETED` / `DEGRADED` |
| startedAt / endedAt | DateTime | |
| tFaultIso / tDetectIso / tDecisionIso / tSwitchIso | DateTime? | from audit events |
| detectMs / decideMs / switchMs | Float? | fault→detect, detect→decision, decision→switch |
| outcome | String? | `FAILOVER` / `REFUSED` / `RESTORED` |
| reasons | String? | `-` or codes joined by `+` |
| downtimeMs | Float? | primary outage (±probe interval) |
| outageOpen | Boolean? | true if service never recovered in window |
| failedRequests | Int? | probes failed inside the outage |
| servedByNoncompliant | Int? | must be 0 (safety invariant SI-1) |
| auditChainOk / auditOrderOk | Boolean? | verifier + event-order results |
| scoreTotal | Float? | 0–100 |
| grade | String? | `A+` `A` `B` `C` `D` |
| observationJson | String? | the gate Observation + re-evaluation results (determinism evidence) |

Indexes: `@@index([scenario])`, `@@index([batchId])`.

### AuditEvent
| Column | Type | Notes |
|---|---|---|
| id | Int autoincrement PK | |
| runId | String | |
| seq | Int | 1-based per run |
| ts | DateTime | UTC, µs stored as DateTime(3) |
| event | String | enum: see doc 06 |
| replica | String | `A` / `B` / `-` |
| decision | String | enum: see doc 06 |
| reason | String | enumerated codes joined by `+`, or `-` |
| policy | String | 12-hex policy hash or `-` |
| prev / hash | String | 64-hex chain |

Constraints: `@@unique([runId, seq])`, `@@index([runId])`. The chain is computed in the engine before insert; the DB never rewrites rows (tampering only happens deliberately via SQL for the verifier demo).

### ProbeRecord
| Column | Type | Notes |
|---|---|---|
| id | Int autoincrement PK | |
| runId | String | |
| seq | Int | probe sequence |
| tSend | DateTime(3) | absolute send time |
| ok | Boolean | status 200 **and** `X-Served-By` present |
| status | Int? | 200 / 502 / 503 |
| latencyMs | Float? | |
| servedBy | String? | `A` / `B` / null |
| epoch | Int? | response `X-Failover-Epoch` |
| error | String? | `timeout` / `conn_error` / `tls_error` / `http_status` / null |

Index: `@@index([runId, seq])`. Live (non-run) probes stay in the in-memory ring buffer only — the DB keeps run evidence, not idle chatter.

### ScoreComponent
| Column | Type | Notes |
|---|---|---|
| id | Int autoincrement PK | |
| runId | String | |
| key | String | `C1`…`C6` |
| label | String | human label |
| points / maxPoints | Float | |
| note | String | short justification, enumerated codes only |

Index: `@@index([runId])`.

## Retention & scale notes

- A 14 s run at 50 ms ≈ 280 probe rows and ≈ 40–80 audit rows; 10 repeats × 9 scenarios ≈ 25 k probe rows — negligible for SQLite.
- `db/custom.db` is the single data file (never committed); `.env` carries `DATABASE_URL=file:../db/custom.db`.
- Live-console audits also persist (runId `live-N`), so manual demonstrations have evidence too.
