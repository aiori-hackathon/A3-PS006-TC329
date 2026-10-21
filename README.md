# AIORI-3-HACKATHON-PROJECTS — PS-006: INTERLOCK

Welcome to the **AIORI-3 Hackathon Projects** repository! 🚀

## 🎥 Hackathon Video
🔗 **[Click here to watch the AIORI-3 Hackathon video on YouTube](https://youtu.be/NX4evW86odk)**

---

# INTERLOCK — PS-006 Control Room

**AIORI Hackathon 3 | Team: Algo-Ancestors | Identifier: A3-PS006-TC329**

INTERLOCK is a high-reliability, fail-closed policy enforcement control room designed for critical infrastructure failover. It operationalizes deterministic compliance gating (Rules R1–R6), cryptographic audit chaining (SHA-256 HMAC), failover scenario execution, and real-time operator observability.

---

## Architecture Overview

```
                                      +------------------------------------+
                                      |            Caddy Gateway           |
                                      |  (Zero-Trust Ingress / Reverse)    |
                                      +-----------------+------------------+
                                                        |
                            +---------------------------+---------------------------+
                            | /socket.io/* (port 3033)                              | All other traffic (port 3000)
                            v                                                       v
         +-------------------------------------+                 +-------------------------------------+
         |       Realtime Bridge Service       |                 |       Control Room Web App          |
         |  (Socket.IO, Auth, Rate Limiter)    |                 |   (Next.js 16, React 19, App Router)|
         +------------------^------------------+                 +------------------+------------------+
                            |                                                       |
                            | (Internal POST /publish with x-lab-token)             | (State, Probes, Scenarios)
                            +-------------------------------------------------------+
                                                        |
                                                        v
                                       +---------------------------------+
                                       |      INTERLOCK Engine Core      |
                                       | - R1-R6 Policy Engine           |
                                       | - FrontDoor Request Proxy       |
                                       | - Probe & Health Monitor Loops  |
                                       | - Asynchronous Audit Queue      |
                                       +----------------+----------------+
                                                        |
                                                        v
                                       +---------------------------------+
                                       |     Prisma SQLite Storage       |
                                       |   (db/custom.db: Runs, Audit,   |
                                       |    Policy, Scores, Probes)      |
                                       +---------------------------------+
```

### Core Subsystems
1. **Zero-Trust Reverse Proxy (`Caddyfile`)**:
   - Eliminates SSRF vectors by routing strictly to fixed loopback upstreams (`localhost:3000` for application traffic and `localhost:3033` for WebSocket traffic).
   - Internal `/publish` endpoint is isolated from external ingress.
2. **Realtime WebSocket Bridge (`mini-services/realtime`)**:
   - Event broadcast bridge powered by Socket.IO.
   - Enforces 512 KB payload caps, allowed event type schema validation (`state`, `audit`, `probe`, `health`, `fault`, `policy`, `run`), and constant-time token authentication.
3. **Deterministic Policy Engine (`src/server/lab/policy.ts`)**:
   - Evaluates compliance rules R1 through R6:
     - **R1**: Candidate reachable (short-circuits with `R1_UNREACHABLE`).
     - **R2**: Valid TLS certificate trust (`R2_CERT_UNTRUSTED`).
     - **R3**: Allowed geographical/jurisdictional location (`R3_LOCATION_NOT_ALLOWED`).
     - **R4**: Location matching cert subject/SAN (`R4_LABEL_CERT_MISMATCH`).
     - **R5**: Minimum TLS version (≥ TLS 1.3; strict enforcement flags legacy fallbacks with `R5_TLS_BELOW_MIN`).
     - **R6**: Minimal logging configuration (`R6_LOGGING_NOT_MINIMAL`).
   - Multiple violations preserve strict deterministic reason code ordering (e.g. S3: `R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN`).
4. **Cryptographic Audit Log & Verifier (`src/server/lab/audit.ts`)**:
   - SHA-256 HMAC hash chain where each record's hash commits to canonicalized JSON payload and the preceding record's hash (`GENESIS` link on initial record).
   - In-order persistence guaranteed via `AuditPersistenceQueue`.
   - Independent verification detects payload tampering, sequence gaps, and broken hash links.
5. **Scoring Engine (`src/server/lab/scoring.ts`)**:
   - Evaluates runs against 6 objective components (C1–C6) totaling 100 points:
     - **C1** (20 pts): Realized vs expected outcome (`FAILOVER`, `REFUSED`, `RESTORED`).
     - **C2** (10 pts): Exact reason code matching.
     - **C3** (20 pts): Strict safety invariant (`servedByNoncompliant == 0`). Any violation clamps the final run grade to **D**.
     - **C4** (20 pts): Persisted audit chain cryptographic integrity (12 pts) and event ordering validity (8 pts).
     - **C5** (20 pts): Downtime responsiveness budget and sustained fail-closed 503 behavior for refusals.
     - **C6** (10 pts): Determinism replay: gate observation replayed 3× must match the recorded decision and reason ordering.

---

## Simulation vs Production Infrastructure Boundaries

To maintain rigorous engineering honesty, the boundary between in-memory simulation and real production infrastructure is documented below:

| Feature / Subsystem | Implementation Type | Reality / Implementation Details |
|---|---|---|
| **Web UI & Control Room** | **Real Production** | Full Next.js 16 App Router application, React 19, TailwindCSS, accessible Radix UI primitives. |
| **API & Mutations** | **Real Production** | HTTP REST endpoints with constant-time API key / Bearer authentication and input sanitization. |
| **Realtime WebSockets** | **Real Production** | Socket.IO server running on port 3033, broadcasting live health, probes, and audits to browser clients. |
| **Database Persistence** | **Real Production** | SQLite database (`db/custom.db`) managed via Prisma ORM with transactional writes and foreign keys. |
| **Cryptographic Verifier** | **Real Production** | SHA-256 HMAC audit chaining, canonical JSON serialization, and independent cryptographic proof verification. |
| **Lab CA & PKI Hierarchy** | **Real Production** | Cryptographically valid X.509 v3 certificates with Subject Alternative Names (DNS, IP, SPIFFE URI) signed by Lab Root CA (`pki/`). |
| **Physical Replica Microservices** | **Real Production** | Standalone Node HTTPS servers (`mini-services/replica/`) exposing `/health`, `/data`, `/meta`, mounting Lab CA certs, and executing live fault injection. |
| **Container Orchestration** | **Real Production** | Full Docker Compose environment (`docker-compose.yml`) running Replica A, Replica B, Controller, and Realtime bridge. |
| **Simulation Fast-Path** | *In-Process Option* | In addition to physical replica containers, an in-process `ReplicaSim` mode is available for instantaneous zero-dependency browser demonstrations. |

---

## Quickstart (One-Command Launch)

### On Windows
```cmd
start.bat
```
*(Automatically verifies dependencies, builds PKI certs, generates Prisma client, starts Realtime Bridge, and launches Next.js on `http://localhost:3000`)*

### On Linux / macOS
```bash
./start.sh
```

### With Docker Compose (Containers + Real HTTPS Endpoints)
```bash
docker compose up -d
```

### With Make
```bash
make demo    # Automated scenario and invariant demonstration
make test    # Run full 58-test suite
make up      # Start Docker containers
```

---

## Mentor Reference Pseudocode (FR-54)

A complete one-page algorithmic pseudocode specification for mentors and evaluators is provided at:
- **[`pseudocode.md`](pseudocode.md)** (Root)
- **[`docs/pseudocode.md`](docs/pseudocode.md)** (Docs)

It specifies:
1. `FailoverController` top-level event loop and serialized state transitions
2. `HealthMonitorLoop` and passive accelerated failure detection
3. `PolicyGate` deterministic evaluation (Rules R1–R6)
4. `HandleHealthChange` failover state machine with **Hold-and-Retry** (FR-19) and Fail-Closed (503)
5. `AuditAppend` canonical tamper-evident hash chaining
6. `FrontDoorProxy` and `MeasureDowntime` absolute-schedule probe math

---

## Lab PKI Hierarchy (FR-02 & FR-03)

The Lab PKI certificates are stored under [`pki/`](pki/) and generated via `node scripts/generate-pki.mjs`:

| Entity | Role | Subject | Issuer | SANs | Status |
|---|---|---|---|---|---|
| `ca/ca.crt` | Root CA | C=IN, O=AIORI PS-006 Lab, CN=Lab Root CA | Self-Signed | cA=TRUE | Trusted Root |
| `ca/rogue-ca.crt` | Rogue CA | C=XX, O=Rogue Lab, CN=Rogue Untrusted CA | Self-Signed | cA=TRUE | Untrusted (R2 trigger) |
| `replica-a/tls.crt` | Replica A | C=IN, CN=replica-a.lab.local | Lab Root CA | URI:spiffe://lab/replica/in | Compliant |
| `replica-b/compliant.crt` | Replica B | C=IN, CN=replica-b.lab.local | Lab Root CA | URI:spiffe://lab/replica/in | Compliant |
| `replica-b/wrong-location.crt` | Replica B | C=EU, CN=replica-b.lab.local | Lab Root CA | URI:spiffe://lab/replica/eu | Policy Refused (R3) |
| `replica-b/label-mismatch.crt` | Replica B | C=IN, CN=replica-b.lab.local | Lab Root CA | URI:spiffe://lab/replica/eu | Policy Refused (R4) |
| `replica-b/untrusted.crt` | Replica B | C=IN, CN=replica-b.lab.local | Rogue CA | URI:spiffe://lab/replica/in | Gate Refused (R2) |

---

## Multi-Runtime Python Verification (NFR-09 & FR-32)

To verify determinism and cryptographic integrity across multiple independent runtimes:

```bash
# Verify policy R1-R6 evaluation equivalence in Python:
python scripts/evaluate_policy.py

# Verify SQLite database audit hash chains in Python:
python scripts/verify_audit.py
```

---

## Getting Started (Manual Setup)

### Prerequisites
- Node.js (v20+ with npm) or [Bun](https://bun.sh/) (v1.2+)
- [Docker](https://www.docker.com/) (optional, for containerized run)
- [Caddy](https://caddyserver.com/) (optional, for edge reverse-proxying)

### Installation
```bash
# Clone the repository and navigate to the project directory
git clone https://github.com/7H-ANKUR/A3-PS006-TC329.git
cd A3-PS006-TC329

# Install dependencies & generate PKI certs
npm install
npm run pki
npm run db:generate
```

### Environment Configuration
Copy `.env.example` to `.env` and configure your credentials:
```bash
cp .env.example .env
```

Key environment variables:
- `DATABASE_URL`: `file:../db/custom.db`
- `ADMIN_API_KEY`: Strong secret key for operator mutation endpoints (`x-admin-key`). Must be set in production.
- `SESSION_SECRET`: Secret key used for signing `HttpOnly` operator session cookies.
- `AUDIT_HMAC_KEY`: Optional ≥32-character secret for v2 HMAC-SHA-256 audit chaining. If omitted, engine uses v1 SHA-256.
- `ALLOW_TAMPER_DEMO`: Set to `true` to enable demonstration endpoints (`/api/audit/tamper`, `/api/audit/restore`). Disabled (403) by default.
- `REALTIME_TOKEN`: Secret shared token between engine and WebSocket bridge.
- `REALTIME_PORT`: `3033`

---

## Running the Services

### 1. Start the Realtime Bridge (Terminal 1)
```bash
bun run mini-services/realtime/index.ts
```

### 2. Start the Control Room (Terminal 2)
```bash
# Development mode:
bun run dev

# Or Production mode:
bun run build
bun run start
```

### 3. Start Caddy Gateway (Terminal 3, optional)
```bash
caddy run
```

---

## Verification & Testing Pipeline

Run the comprehensive test suite verifying security, policy determinism, audit integrity, scoring, and engine lifecycle:

```bash
# Run all unit and integration test suites
bun test

# Run TypeScript type checker (strict mode, 0 errors)
bun x tsc --noEmit

# Run Next.js production standalone build
bun run build
```

### Test Suite Summary
- `tests/policy.test.ts`: Evaluates R1–R6 rule execution, short-circuit logic, multi-reason ordering (S3), and YAML parser safety.
- `tests/audit.test.ts`: Tests canonical JSON sorting, genesis hash linking, tamper detection, sequence gap identification, and Date normalization.
- `tests/scoring.test.ts`: Tests C1–C6 scoring calculations, grade D clamping on safety violations, refusal latency, and determinism replay.
- `tests/security.test.ts`: Tests API key authentication, Bearer tokens, cookies, timing-attack resistance, bridge token validation, payload limits, and Caddyfile SSRF immunity.
- `tests/engine-lifecycle.test.ts`: Tests collision-free session ID generation across restarts, FIFO asynchronous queue flushing, and active vs closed outage analysis.

---

## Operator Demonstrator Workflow (Pseudocode)

Below is an annotated demonstrator script illustrating how an operator interacts with INTERLOCK to verify a failover scenario:

```typescript
import { req } from "@/lib/lab-api";

async function runDemonstrator() {
  const adminKey = process.env.ADMIN_API_KEY ?? "interlock-admin-secret";
  const headers = { "x-admin-key": adminKey };

  // 1. Inspect engine state
  const state = await req("/api/lab/state");
  console.log(`Current active replica: ${state.active}, epoch: ${state.epoch}`);

  // 2. Start Scenario S3 (Candidate fails location and TLS policy)
  console.log("Triggering Scenario S3...");
  const run = await req("/api/scenario/start", {
    method: "POST",
    headers,
    body: JSON.stringify({ scenarioId: "S3", repeats: 1 }),
  });

  // 3. Monitor execution via WebSocket or polling
  let status = await req("/api/scenario/status");
  while (status.running) {
    await new Promise((r) => setTimeout(r, 200));
    status = await req("/api/scenario/status");
  }

  // 4. Retrieve Run Details and Scored Evidence
  const runDetail = await req(`/api/runs/${status.lastRunId}`);
  console.log(`Outcome: ${runDetail.run.outcome} (Expected: REFUSED)`);
  console.log(`Score: ${runDetail.run.scoreTotal} | Grade: ${runDetail.run.scoreGrade}`);
  console.log(`Safety Invariant (servedByNoncompliant): ${runDetail.run.servedByNoncompliant}`);

  // 5. Cryptographically verify the audit trail
  const verification = await req("/api/audit/verify", {
    method: "POST",
    headers,
    body: JSON.stringify({ runId: status.lastRunId }),
  });
  console.log(`Audit Chain Valid: ${verification.valid} (Checked ${verification.recordCount} records)`);
}
```

---

## Design System

The INTERLOCK Control Room interface adheres strictly to the industrial signal-box visual aesthetic:
- **Canvas / Background**: Off-white `#EDEFE9`
- **Ink / Typography**: Near-black `#191C1A`
- **Typefaces**: Overpass (UI & display) and Martian Mono (code, metrics, evidence)
- **Status Accents**: Muted signal amber, brick red, and railway green

---

## Project Documentation Index

All core architectural specifications and engineering guides are cataloged in [`docs/`](docs/):

- **System Architecture & Design**:
  - [`docs/Architecture.md`](docs/Architecture.md) — Architectural drivers, trust boundaries, fail-closed topology
  - [`docs/System Design.md`](docs/System%20Design.md) — Module designs, protocols, crypto schemas, TLS/PKI constraints
  - [`docs/MVP Tech Doc.md`](docs/MVP%20Tech%20Doc.md) — Technical implementation blueprint, reference code, matrix runs
  - [`docs/PRD.md`](docs/PRD.md) — Product requirements document (FR-01 to FR-53, NFRs)
- **Hackathon Submissions & Templates**:
  - [`docs/AIORI3_PS006_Algo-Ancesstors.pdf`](docs/AIORI3_PS006_Algo-Ancesstors.pdf) — Team presentation deck & submission
  - [`docs/Proposed-structure-hackathon.pdf`](docs/Proposed-structure-hackathon.pdf) — Official AIORI hackathon structure template
- **Operator Manual & Reference Pseudocode**:
  - [`usermanual.md`](usermanual.md) — Comprehensive operator and evaluator user manual
  - [`pseudocode.md`](pseudocode.md) — One-page algorithmic pseudocode specification for mentors (FR-54)
- **Modular Engineering Specifications**:
  - [`docs/01-product-requirements.md`](docs/01-product-requirements.md) through [`docs/12-testing-strategy.md`](docs/12-testing-strategy.md)

