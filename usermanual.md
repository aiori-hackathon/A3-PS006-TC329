# INTERLOCK — Operator & Evaluator User Manual

> **AIORI Hackathon 3 | Team: Algo-Ancestors (`A3-PS006-TC329`)**  
> **System:** PS-006 Policy-Constrained Service Failover Demonstrator  
> **Interface:** Web Control Room, REST API, CLI & Docker Orchestration

---

## 1. Introduction

### What is INTERLOCK?
Ordinary automated failover answers only one question: *"Is another replica reachable?"* If yes, traffic is routed there immediately. While this keeps a system online, it poses severe risks for critical infrastructure:
- Traffic may cross national boundaries into unauthorized jurisdictions (**data residency violations**).
- User requests may land on servers running obsolete or weak encryption (**TLS downgrade attacks**).
- Traffic may route to non-certified instances or servers with unauthorized logging (**compliance breaches**).

**INTERLOCK** solves this by inserting a **deterministic, cryptographically verifiable policy gate** directly into the failover decision loop. Before any traffic shifts to a candidate replica, the engine verifies the candidate against pure, side-effect-free policy rules (**R1 through R6**). If the candidate is non-compliant, INTERLOCK refuses to switch and **fails closed (HTTP 503)**, guaranteeing that **no user request is ever served by a non-compliant server** (Safety Invariant `SI-1`).

---

## 2. Quickstart Guide

INTERLOCK can be launched with a single command on any platform.

### Option A: Windows (One-Click Batch Script)
```cmd
start.bat
```
*Automatically validates dependencies, builds X.509 PKI certificates, generates the Prisma ORM client, starts the background Realtime WebSocket bridge, and launches the Control Room web app at `http://localhost:3000`.*

### Option B: Linux / macOS (Shell Script)
```bash
chmod +x start.sh
./start.sh
```

### Option C: Docker Compose (Full Containerized Topology)
```bash
docker compose up -d
```
*Spins up isolated containers for Replica A (port 8443), Replica B (port 8444), Realtime Bridge (port 3033), and Controller (port 3000).*

### Option D: Make Automation
```bash
make demo    # Run automated invariant validation demo
make test    # Execute complete 58-test verification suite
make pki     # Regenerate Lab Root CA and leaf certificates
```

---

## 3. Web Control Room Walkthrough

Once started, open **`http://localhost:3000`** in your browser. The Control Room features an industrial signal-box interface divided into four primary workspaces:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  [CONSOLE]           [SCENARIOS]           [POLICY]           [RECORDS]    │
└────────────────────────────────────────────────────────────────────────────┘
```

### 1. Console (Live Observability & Manual Control)
- **SVG Route Topology**: Real-time visual route diagram showing traffic path from Front Door to active replica.
- **Replica Nodes (A & B)**: Live cards showing replica state (`SERVING`, `STANDBY`, `UNHEALTHY`), declared location, certificate SAN URI, TLS version, and logging claim.
- **Live Downtime & Latency Strip Chart**: Real-time 50 ms resolution probe telemetry measuring availability, response times, and ongoing outages.
- **Manual Policy-Gated Switch**: Allows operators to request a manual switch to Replica A or B. If the target violates policy, the switch is immediately refused and audited.
- **Fault Injectors**: Quick-action toggles to inject **Process Crash**, **Link Loss**, or **Service Overload** directly into the active replica.

### 2. Scenarios (Automated PS-006 Suite S1–S9)
- Run any of the 9 benchmark scenarios defined in the PS-006 specification.
- Configure scenario repeats (1× to 10×) to calculate mean, p50, p95, min, and max downtime.
- Watch live stage-by-stage execution (`WARMUP` → `INJECT` → `OBSERVE` → `CLEANUP`).
- View the **Automated Scoring Card (C1–C6)** with grades from **A+** down to **D**.

### 3. Policy Studio
- Interactive YAML editor for live policy configuration.
- Real-time schema validation ensuring policy conforms to strict types.
- Hot-reload policy without restarting services.
- Displays policy SHA-256 fingerprint that commits to the cryptographic audit trail.

### 4. Records & Audit Tape
- Chronological, tamper-evident audit tape showing every state change, health event, policy gate decision, and route transition.
- **Tamper Demonstration & Verification**: Intentionally tamper with audit records in SQLite to observe how the cryptographic verifier detects altered fields, sequence gaps, or broken hash links.

---

## 4. Running Benchmark Scenarios (S1 – S9)

To run a scenario from the Control Room:
1. Navigate to the **Scenarios** tab.
2. Click on the desired scenario card (e.g., **S3: Overload with Non-Compliant Candidate**).
3. Click **"Run Scenario"**.

| Scenario | Injected Fault | Candidate Profile | Expected Outcome | Triggered Reason Codes |
|---|---|---|---|---|
| **S1** | Crash | `compliant` | **FAILOVER** | `[]` (Passes all rules) |
| **S2** | Link Loss | `compliant` | **FAILOVER** | `[]` (Passes all rules) |
| **S3** | Overload | `eu_weak_tls` | **REFUSED** | `R3_LOCATION_NOT_ALLOWED + R5_TLS_BELOW_MIN` |
| **S4** | Crash | `weak_tls` | **REFUSED** | `R5_TLS_BELOW_MIN` |
| **S5** | Link Loss | `wrong_location` | **REFUSED** | `R3_LOCATION_NOT_ALLOWED` |
| **S6** | Overload | `compliant` | **FAILOVER** | `[]` (Passes all rules) |
| **S7** | Crash | `label_mismatch` | **REFUSED** | `R4_LABEL_CERT_MISMATCH` |
| **S8** | Crash | `verbose_logging`| **REFUSED** | `R6_LOGGING_NOT_MINIMAL` |
| **S9** | Crash | `weak_tls` (Refused), A restored | **RESTORED** | Candidate refused (`R5`), original restored |

---

## 5. Scoring Engine Invariants (C1 – C6)

Every scenario run is evaluated automatically by the 100-point scoring engine:

- **C1: Outcome Accuracy (20 Points)**: Did the final state match expectations (`FAILOVER`, `REFUSED`, `RESTORED`)?
- **C2: Reason Code Accuracy (10 Points)**: Did the policy gate emit the exact expected ordered reasons (e.g. `R3+R5`)?
- **C3: Safety Invariant (20 Points)**: `servedByNoncompliant == 0`. **Critical rule:** Any violation immediately clamps the run grade to **D**, regardless of other points.
- **C4: Cryptographic Integrity (20 Points)**: Persisted audit chain valid (12 pts) + correct event ordering (8 pts).
- **C5: Responsiveness Budget (20 Points)**: Downtime within target budget; fast refusal and sustained 503 fail-closed behavior for refused scenarios.
- **C6: Determinism Replay (10 Points)**: Gate inputs replayed 3 consecutive times must yield identical decisions.

---

## 6. Policy Rules Reference (R1 – R6)

Policy files use standard YAML:

```yaml
policyId: strict-in-v1
version: "1.0"
allowedLocations:
  - "IN"
tlsMinVersion: "1.2"
allowVerboseLogging: false
tlsEnforcement: standard # or "no_legacy_support"
```

### Evaluation Hierarchy:
1. **R1 (`R1_UNREACHABLE`)**: Short-circuits if the candidate replica is offline or does not respond within the decision timeout (500 ms).
2. **R2 (`R2_CERT_UNTRUSTED`)**: Short-circuits if the candidate certificate is not signed by the trusted Lab CA.
3. **R3 (`R3_LOCATION_NOT_ALLOWED`)**: Flags if declared location or cert location is outside `allowedLocations`.
4. **R4 (`R4_LABEL_CERT_MISMATCH`)**: Flags if declared location does not match the location encoded in the certificate SAN URI.
5. **R5 (`R5_TLS_BELOW_MIN`)**: Flags if negotiated TLS version is below `tlsMinVersion` (e.g., TLS 1.1), or if `tlsEnforcement: no_legacy_support` is enabled and the server accepts legacy handshakes.
6. **R6 (`R6_LOGGING_NOT_MINIMAL`)**: Flags if the replica uses verbose logging when `allowVerboseLogging: false`.

---

## 7. Cryptographic Audit Verification

Every event is committed to a hash chain:
$$\text{Hash}_n = \text{SHA-256}(\text{Hash}_{n-1} + \text{CanonicalJSON}(\text{Event}_n))$$

### In-Browser Verification:
1. Navigate to **Records** tab.
2. Select any past run.
3. Click **"Verify Cryptographic Chain"**.
4. The system validates all hashes from `GENESIS` ($0^{64}$) to the terminal record.

### Command-Line Python Verification:
You can verify SQLite database records or exported JSONL files independently:
```bash
# Verify the latest database run
python scripts/verify_audit.py

# Verify a specific run by ID
python scripts/verify_audit.py --run <RUN_ID>

# Verify an exported JSON/JSONL file
python scripts/verify_audit.py --file path/to/audit.jsonl
```

---

## 8. Standalone Physical Replicas & PKI

In addition to in-process simulation, INTERLOCK includes standalone HTTPS microservices and Lab PKI tools:

### Regenerate PKI Certificates:
```bash
node scripts/generate-pki.mjs
```
Generates root and leaf certificates with SAN URIs under [`pki/`](pki/).

### Start Physical Replicas:
```bash
# Start Replica A (HTTPS Port 8443, Location IN)
REPLICA_ID=A PORT=8443 node mini-services/replica/server.mjs

# Start Replica B (HTTPS Port 8444, Selectable Profile)
REPLICA_ID=B PORT=8444 REPLICA_PROFILE=compliant node mini-services/replica/server.mjs
```

### Replica Endpoints:
- `GET https://127.0.0.1:8443/health` — Health check status and uptime.
- `GET https://127.0.0.1:8443/data` — Protected data endpoint.
- `GET https://127.0.0.1:8443/meta` — Metadata, SAN location, and TLS details.
- `POST https://127.0.0.1:8443/fault` — Inject fault: `{"fault": "CRASH"|"LINK_LOSS"|"OVERLOAD"}`.
- `POST https://127.0.0.1:8443/clear-fault` — Restore replica to clean state.
- `POST https://127.0.0.1:8443/profile` — Switch profile dynamically (e.g. `wrong_location`).

---

## 9. API Reference & Automation

All operations can be driven programmatically via the REST API. Mutation endpoints require the `x-admin-key` header (configured via `ADMIN_API_KEY` in `.env`).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/lab/state` | Current route mode, active replica, epoch, and replica status. |
| `POST` | `/api/lab/switch` | Request manual switch `{ "target": "A" \| "B" }` (policy gated). |
| `POST` | `/api/lab/fault` | Inject fault `{ "replica": "A", "fault": "CRASH" }`. |
| `POST` | `/api/lab/fault/clear` | Clear faults on all replicas. |
| `POST` | `/api/scenario/start` | Launch scenario `{ "scenarioId": "S3", "repeats": 3 }`. |
| `GET` | `/api/scenario/status` | Current scenario runner status, phase, and live summary. |
| `GET` | `/api/policy` | Fetch active YAML policy and SHA-256 fingerprint. |
| `POST` | `/api/policy/reload` | Hot-reload YAML policy `{ "yaml": "..." }`. |
| `POST` | `/api/audit/verify` | Verify cryptographic hash chain `{ "runId": "..." }`. |
| `GET` | `/api/runs/[runId]` | Full evidence packet, probe records, and scoring components. |

---

## 10. Frequently Asked Questions (FAQ)

**Q: What happens if both Replica A and B fail or are non-compliant?**  
A: INTERLOCK enters `UNAVAILABLE` mode and returns HTTP 503 (`NO_COMPLIANT_REPLICA`). It will continuously re-evaluate both replicas in the background and restore service as soon as a compliant replica recovers.

**Q: Does INTERLOCK support automatic failback?**  
A: By design, INTERLOCK enforces **sticky active** routing (FR-18). It does not automatically fail back to Replica A when A recovers if Replica B is healthy and compliant, preventing unnecessary traffic flaps. Failback only occurs if the active replica fails or an operator executes a manual switch.

**Q: Can I run this with standard Node.js without Bun?**  
A: Yes! The entire test suite, PKI generator, and server can run natively on Node.js (v20+) using `npm install` and `npm test`.
