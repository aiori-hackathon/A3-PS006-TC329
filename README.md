# INTERLOCK — PS-006 Policy-Constrained Service Failover Control Room

> **AIORI Hackathon 3 | Problem Statement: PS-006**  
> **Team: Algo-Ancestors | Team Identifier: `A3-PS006-TC329`**  
> **Repository:** [https://github.com/aiori-hackathon/A3-PS006-TC329](https://github.com/aiori-hackathon/A3-PS006-TC329)  
> **🎥 Video Demonstration:** [Watch on YouTube](https://youtu.be/NX4evW86odk)

---

## 📑 Table of Contents
1. [Executive Summary & Problem Statement](#1-executive-summary--problem-statement)
2. [Evaluator Quickstart (One-Command Launch)](#2-evaluator-quickstart-one-command-launch)
3. [Live Evaluator 2-Minute Walkthrough](#3-live-evaluator-2-minute-walkthrough)
4. [System Architecture & Data Flow](#4-system-architecture--data-flow)
5. [The S1–S9 Scenario Matrix (Full Specification)](#5-the-s1s9-scenario-matrix-full-specification)
6. [Deterministic Policy Rules (R1–R6)](#6-deterministic-policy-rules-r1r6)
7. [Cryptographic Audit Chaining & Verification](#7-cryptographic-audit-chaining--verification)
8. [Automated Scoring Engine (C1–C6)](#8-automated-scoring-engine-c1c6)
9. [Physical PKI Hierarchy & Zero-Trust Gateway](#9-physical-pki-hierarchy--zero-trust-gateway)
10. [Technology Stack & Implementation Boundary](#10-technology-stack--implementation-boundary)
11. [Environment Variables Reference](#11-environment-variables-reference)
12. [Automated Verification & Test Suite (58/58 Passing)](#12-automated-verification--test-suite-5858-passing)
13. [Submission Documentation Index](#13-submission-documentation-index)

---

## 1. Executive Summary & Problem Statement

### The Problem
Conventional automated failover systems answer only one simplistic question:  
*"Is an alternate replica responding to network probes?"*

If yes, traffic is immediately switched. In critical national infrastructure, healthcare, defense, and cross-border financial networks, this blind failover creates catastrophic risks:
- **Data Sovereignty Violations**: Traffic shifts to servers in non-authorized jurisdictions (e.g. EU traffic diverted to non-compliant regions).
- **TLS Downgrade Attacks**: Routing into legacy servers accepting weak or obsolete ciphers (TLS 1.0/1.1/1.2).
- **Identity Spoofing**: Accepting servers with self-signed, rogue, or mismatched certificate identities.
- **Compliance Penalties**: Unaudited traffic served with improper logging levels or unverified data-retention configurations.

### The INTERLOCK Solution
**INTERLOCK** introduces an automated, deterministic **Policy Gate** directly into the failover decision loop. Before any user traffic can be rerouted to a candidate replica, INTERLOCK evaluates the candidate against pure, side-effect-free compliance rules (**R1 through R6**).

- **Safety Invariant `SI-1`**: **0 user requests are EVER served by a non-compliant server** (`servedByNoncompliant == 0`).
- **Fail-Closed Guarantee**: If a candidate replica fails any compliance rule, INTERLOCK **refuses failover and enters a fail-closed HTTP 503 state**, prioritizing legal and cryptographic safety over unconstrained uptime.
- **Cryptographic Audit Proof**: Every observation, decision, and route shift is committed into an append-only, tamper-evident **SHA-256 HMAC hash chain** that allows independent, mathematical verification of compliance integrity.

```
       [Candidate Failing Policy]
                   │
                   ▼
┌──────────────────────────────────────┐
│       INTERLOCK Policy Gate          │ ──► [VIOLATION DETECTED]
└──────────────────────────────────────┘            │
                   │                                ▼
         Traffic Diverted?                  [FAIL-CLOSED 503]
                NO!                    (Zero Noncompliant Requests)
```

---

## 2. Evaluator Quickstart (One-Command Launch)

INTERLOCK is completely cross-platform and requires zero external database configuration.

### Option A: Windows (One-Click Automated Batch Script)
```cmd
start.bat
```
*Validates Node.js, generates private PKI certificates, configures Prisma SQLite, starts the Realtime Bridge, and launches the Control Room at `http://localhost:3000`.*

### Option B: Linux / macOS (One-Click Shell Script)
```bash
chmod +x start.sh
./start.sh
```

### Option C: Full Containerized Docker Compose Topology
```bash
docker compose up -d
```
*Spins up the full isolated microservice topology: Controller (port 3000), Realtime WebSocket Bridge (port 3033), Physical Replica A (port 8443), and Physical Replica B (port 8444).*

### Option D: Make Automation
```bash
make demo    # Runs automated end-to-end scenario demonstration
make test    # Runs complete 58-test verification suite
make pki     # Re-generates Lab Root CA and leaf X.509 certs
```

---

## 3. Live Evaluator 2-Minute Walkthrough

Once launched, open **`http://localhost:3000`** in your browser to experience the industrial signal-box Control Room:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  [CONSOLE]           [SCENARIOS]           [POLICY]           [RECORDS]    │
└────────────────────────────────────────────────────────────────────────────┘
```

### Step 1: Observe Compliant Failover (Scenario S1)
1. Go to the **Scenarios** tab.
2. Click **Run** on **Scenario S1 (Baseline Compliant Failover)**.
3. Switch to the **Console** tab:
   - Notice Replica A faulted (HTTP 500 injected).
   - Policy Gate evaluates Replica B: **PASS** (compliant TLS 1.3, Location IN, Root CA signed).
   - Traffic smoothly switches to Replica B (`PASS: COMPLIANT_FAILOVER`).
   - Run finishes with a perfect **100/100 score and Grade A+**.

### Step 2: Observe Policy Refusal & Fail-Closed Safety (Scenario S3)
1. In the **Scenarios** tab, click **Run** on **Scenario S3 (Non-Compliant Location + Weak TLS)**.
2. Watch the live execution:
   - Replica A faults.
   - Policy Gate checks candidate B: **REFUSED** (`R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN`).
   - INTERLOCK **fails closed (HTTP 503)**.
   - Check **Safety Violations**: strictly **`0`**. The system refused to compromise security.
   - Run achieves **100/100 score and Grade A+** for correct policy enforcement.

### Step 3: Cryptographic Audit Verification & Tamper Detection
1. Open the **Records** tab and click on the completed run to view the detailed evidence modal.
2. View the full timeline, probe latency distribution, and C1–C6 score breakdown.
3. Click **Verify chain**:
   - The verifier walks every cryptographic block from `GENESIS` to the head:  
     `Audit chain verified: links intact, 0 sequence gaps`.
4. Click **Tamper row** (simulates an attacker modifying an audit record in the database):
   - Row 3 decision is maliciously rewritten from `REFUSE` to `ALLOW`.
   - Click **Verify chain**:  
     `Audit chain BROKEN: line 3: hash mismatch`! The tamper is instantly caught.
5. Click **Restore row** -> Click **Verify chain** -> `Audit chain verified: links intact`.

---

## 4. System Architecture & Data Flow

```
                                    +------------------------------------+
                                    |            Caddy Gateway           |
                                    |    (Zero-Trust Ingress / Reverse)  |
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
                                     | - R1-R6 Deterministic Policy    |
                                     | - FrontDoor Zero-Safety Proxy   |
                                     | - Active Probe & Health Monitors|
                                     | - Async Tamper-Proof Audit Queue|
                                     +----------------+----------------+
                                                      |
                                                      v
                                     +---------------------------------+
                                     |     Prisma SQLite Storage       |
                                     |   (dev.db: Runs, Audit, Policy, |
                                     |    Scores, Microsecond Probes)  |
                                     +---------------------------------+
```

### Architectural Highlights
- **Zero-Trust Network Proxy**: Ingress traffic is strictly scoped. Internal administrative routes and the realtime `/publish` socket bus are completely blocked from external tampering.
- **Dual-State Engine**: Real-time in-memory execution delivers microsecond telemetry to the browser, while the background `AuditPersistenceQueue` writes serial, transactional SQLite records.
- **Resilient Fallback**: The API routes feature automated schema initialization (`ensureDbReady()`) and transparent in-memory fallbacks, guaranteeing zero downtime and zero 500 errors during judge evaluation.

---

## 5. The S1–S9 Scenario Matrix (Full Specification)

INTERLOCK tests and scores the complete PRD scenario matrix:

| Scenario | Name | Candidate B Profile | Expected Gate Decision | Rule Codes Triggered | Expected Outcome | Target Score |
|---|---|---|:---:|---|:---:|:---:|
| **S1** | Baseline Compliant Failover | Compliant (IN, TLS 1.3) | **PASS** | None (All rules pass) | `FAILOVER` | **100 (A+)** |
| **S2** | Candidate Unreachable | Unreachable / Offline | **REFUSE** | `R1_UNREACHABLE` | `REFUSED` (503) | **100 (A+)** |
| **S3** | Location & TLS Violation | EU Location, TLS 1.2 | **REFUSE** | `R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN` | `REFUSED` (503) | **100 (A+)** |
| **S4** | Untrusted Certificate | Signed by Rogue Untrusted CA | **REFUSE** | `R2_CERT_UNTRUSTED` | `REFUSED` (503) | **100 (A+)** |
| **S5** | Location & SAN Mismatch | Declared IN, Cert SAN EU | **REFUSE** | `R4_LABEL_CERT_MISMATCH` | `REFUSED` (503) | **100 (A+)** |
| **S6** | Strict TLS Version Check | TLS 1.2 on Strict Policy | **REFUSE** | `R5_TLS_BELOW_MIN` | `REFUSED` (503) | **100 (A+)** |
| **S7** | Non-Minimal Logging | Verbose Debug Logging | **REFUSE** | `R6_LOGGING_NOT_MINIMAL` | `REFUSED` (503) | **100 (A+)** |
| **S8** | Flapping / Recovery Hold | Degraded -> Recovers | **HOLD -> PASS** | Transient hold, then clean pass | `RESTORED` | **100 (A+)** |
| **S9** | Full Policy Audit Cascade | Multiple Violations | **REFUSE** | Deterministic multi-code ordering | `REFUSED` (503) | **100 (A+)** |

---

## 6. Deterministic Policy Rules (R1–R6)

The Policy Engine ([src/server/lab/policy.ts](file:///d:/Projects/AIROI/AIROI-006/A3-PS006-TC329/src/server/lab/policy.ts)) is side-effect-free, pure, and deterministic:

1. **Rule R1 (`R1_UNREACHABLE`)**: Short-circuits immediately if the candidate replica fails TCP/HTTP connectivity.
2. **Rule R2 (`R2_CERT_UNTRUSTED`)**: Short-circuits immediately if the TLS certificate is self-signed or not signed by the trusted Lab Private CA.
3. **Rule R3 (`R3_LOCATION_NOT_ALLOWED`)**: Flags if the replica's jurisdiction is not in the active policy whitelist (e.g., `["IN"]`).
4. **Rule R4 (`R4_LABEL_CERT_MISMATCH`)**: Flags if the replica's declared location doesn't match its cryptographic certificate subject or SPIFFE SAN.
5. **Rule R5 (`R5_TLS_BELOW_MIN`)**: Flags if the negotiated TLS version is below policy minimum (e.g. `< TLSv1.3`).
6. **Rule R6 (`R6_LOGGING_NOT_MINIMAL`)**: Flags if the candidate's logging profile violates data minimization mandates.

> **Determinism Guarantee**: When multiple violations occur simultaneously, the engine preserves exact canonical reason code order (e.g. S3 always produces `R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN`, never vice-versa).

---

## 7. Cryptographic Audit Chaining & Verification

The Audit Subsystem ([src/server/lab/audit.ts](file:///d:/Projects/AIROI/AIROI-006/A3-PS006-TC329/src/server/lab/audit.ts)) provides cryptographic proof for every failover action:

- **Genesis Block**: Root hash initialized to `0000000000000000000000000000000000000000000000000000000000000000`.
- **Block Chaining**: Each record commits to:
  $$\text{Hash}_n = \text{HMAC-SHA256}(\text{Key}, \text{Hash}_{n-1} \parallel \text{CanonicalJSON}(\text{Record}_n))$$
- **Canonical Serialization**: JSON keys are strictly sorted lexicographically with consistent timestamp normalization, guaranteeing bit-for-bit replayability across Node.js, Python, and Go runtimes.
- **Tamper Detection**: An independent verifier recalculates the entire chain; any modified payload, sequence gap, or broken pointer is pinpointed to the exact line number.

---

## 8. Automated Scoring Engine (C1–C6)

Every run is objectively scored out of **100 points** across 6 independent invariants:

| Metric | Max Points | Invariant Evaluated |
|---|:---:|---|
| **C1: Outcome Correctness** | **20 pts** | Realized outcome matches expected (`FAILOVER`, `REFUSED`, or `RESTORED`). |
| **C2: Reason Code Exactness** | **10 pts** | Exact deterministic policy reason codes match scenario expectation. |
| **C3: Safety Invariant** | **20 pts** | Strictly checks `servedByNoncompliant == 0`. **ANY violation immediately clamps final grade to D**, overriding all other points. |
| **C4: Cryptographic Chain** | **20 pts** | Hash chain cryptographic integrity (12 pts) + sequential monotonic order (8 pts). |
| **C5: Latency Budget & Refusal** | **20 pts** | Failover completes within downtime budget, or refusal sustains fail-closed 503 behavior. |
| **C6: Determinism Replay** | **10 pts** | Candidate observation is re-evaluated 3× in memory; all 3 passes must produce identical decisions and reason codes. |

---

## 9. Physical PKI Hierarchy & Zero-Trust Gateway

### Lab X.509 Certificate Tree
All certificates are pre-generated in [`pki/`](pki/) and can be re-generated at any time via `node scripts/generate-pki.mjs`:

```
                       +-----------------------------+
                       |    Lab Root CA (X.509)      |
                       |  CN=Lab Root CA, C=IN       |
                       +--------------+--------------+
                                      |
         +----------------------------+----------------------------+
         |                                                         |
         v                                                         v
+-------------------------------+                         +-------------------------------+
|    Replica A Leaf Cert        |                         |    Replica B Leaf Cert        |
| CN=replica-a.interlock.local  |                         | CN=replica-b.interlock.local  |
| SAN: URI:spiffe://lab/in      |                         | SAN: URI:spiffe://lab/in      |
+-------------------------------+                         +-------------------------------+
```

A **Rogue CA** is also generated to physically test and prove Rule R2 untrusted certificate rejection.

---

## 10. Technology Stack & Implementation Boundary

| Layer | Technology | Purpose |
|---|---|---|
| **Control Room UI** | Next.js 16 (Turbopack), React 19, TailwindCSS | Industrial signal-box dashboard & operator cockpit |
| **Core Engine** | TypeScript (Strict Mode) | Deterministic state machine, policy gate, and scoring |
| **Persistence** | Prisma ORM, SQLite (`dev.db`) | ACID transactional logging of runs, audit tapes, and probe stats |
| **Realtime Telemetry** | Socket.IO, Node.js (`port 3033`) | High-frequency probe & health telemetry streaming |
| **Zero-Trust Ingress**| Caddy v2 Reverse Proxy | Edge loopback isolation and SSRF mitigation |
| **Security** | Web Crypto / Node `crypto` | Constant-time HMAC-SHA-256, timing-safe authentication |

### Simulation vs Production Reality
- **Control Room, API, Auth, Cryptography, Database, and Scoring**: 100% Real Production Code.
- **Physical Microservices**: Standalone Node HTTPS servers mount valid X.509 certificates and listen on ports 8443 and 8444.
- **In-Memory Simulation Fast-Path**: Also included so judges can run all 9 scenarios instantly in any browser without needing multi-container Docker overhead.

---

## 11. Environment Variables Reference

A complete `.env.example` is provided in the repository root. All variables have safe production defaults:

```bash
# Database Configuration
DATABASE_URL="file:./dev.db"

# Security & Admin Authentication
ADMIN_API_KEY="interlock-admin-secret"
SESSION_SECRET="interlock-session-secret-key-32chars"
ALLOW_INSECURE_DEMO_MODE="true"

# Cryptographic Audit Chaining
AUDIT_HMAC_KEY="interlock-audit-hmac-secret-at-least-32-bytes"

# Realtime WebSocket Bridge
REALTIME_PORT="3033"
REALTIME_TOKEN="interlock-dev-token"
REALTIME_URL="http://localhost:3033/publish"

# Demo Safety Overrides
ALLOW_TAMPER_DEMO="true"
PORT="3000"
NODE_ENV="production"
```

---

## 12. Automated Verification & Test Suite (58/58 Passing)

Execute the full verification pipeline:

```bash
# 1. Run complete unit and integration test suite (58 tests across 13 suites)
npm test

# 2. Run TypeScript strict typecheck (0 errors)
npx tsc --noEmit

# 3. Build optimized production standalone bundle
npm run build
```

### Test Coverage Highlights
- `tests/policy.test.ts` (11 tests): Rules R1–R6, short-circuiting, deterministic reason code ordering, and YAML parser security.
- `tests/scoring.test.ts` (6 tests): Criteria C1–C6 scoring math, Safety Invariant clamp to Grade D, and determinism replay.
- `tests/security.test.ts` (20 tests): Constant-time header/cookie authentication, CSRF origin enforcement, signed session tokens, payload size limits, and Caddyfile SSRF prevention.
- `tests/engine-lifecycle.test.ts` (21 tests): Asynchronous audit queue FIFO ordering, outage analyzer state transitions, and percentile statistics calculations.

---

## 13. Submission Documentation Index

All primary hackathon deliverables and architectural documents are accessible directly:

- 📖 **[User Manual (usermanual.md)](usermanual.md)**: Full operator guide, UI component walkthrough, and troubleshooting.
- 📐 **[Mentor Reference Pseudocode (pseudocode.md)](pseudocode.md)**: Formal one-page algorithmic pseudocode specification (FR-54).
- ☁️ **[Render Blueprint (render.yaml)](render.yaml)**: One-click cloud deployment specification with automated DB migration.
- 🐳 **[Docker Compose (docker-compose.yml)](docker-compose.yml)**: Complete 4-service containerized deployment topology.
- 📚 **[Technical Documentation Directory (docs/)](docs/)**:
  - `docs/Architecture.md`: Architectural drivers and trust boundaries.
  - `docs/System Design.md`: Module specifications, cryptographic schemas, and protocols.
  - `docs/MVP Tech Doc.md`: Implementation blueprint and PRD requirement mapping.
  - `docs/PRD.md`: Formal product requirements document.

---

> **Algo-Ancestors (`A3-PS006-TC329`) — AIORI Hackathon 3**  
> *Fail-Closed Deterministic Governance for Critical Infrastructure.*
