# Product Requirements Document (PRD)

**Project:** PS-006 Policy-Constrained Service Failover Demonstrator
**Team:** Algo-Ancesstors (ID `A3-PS006-TC329`), AIORI Hackathon 3
**Authors:** Ankur Pratap Singh, Dev Saraswat
**Version:** 0.1 (draft)   **Date:** 2026-10-19   **Status:** Ready for team review

Related documents: [Architecture](Architecture.md) · [System Design](System%20Design.md) · [MVP Tech Doc](MVP%20Tech%20Doc.md)

---

## 1. Summary

Automated failover usually answers one question: *is another replica reachable?* If yes, traffic moves there. That keeps a service alive, but it can also move user traffic to a server in the wrong country or to a server that speaks weaker encryption.

We will build a **policy-constrained failover controller**. It sits in front of two lab replicas as a reverse proxy. When the active replica fails, the controller does not switch blindly. It first checks the candidate replica against a plain, deterministic policy file (location label, TLS baseline, logging profile). It switches only if the candidate passes. If the candidate fails, the controller refuses to switch, raises an alert, and records why.

Everything is measured and recorded: a timestamped audit timeline (failure, decision, failover) and downtime for every run.

This is a **lab demonstrator**. It is not a production system, not a legal compliance engine, and it makes no claim about Internet-path residency.

## 2. Problem statement

| Aspect | Today (ordinary failover) | Problem |
|---|---|---|
| Target choice | Any reachable replica | Traffic may cross a border without anyone deciding it should |
| Encryption | Whatever the replica offers | A replica running TLS 1.1 can silently weaken protection |
| Decision | Opaque | Nobody can later explain why traffic moved |
| Evidence | Scattered logs | No single timeline of failure, decision and failover |
| Downtime | Rarely measured | Claims about "fast failover" are not backed by numbers |

## 3. Goals and non-goals

### 3.1 Goals

- **G1.** Switch a lab service between two replicas automatically when a failure occurs.
- **G2.** Enforce a deterministic policy (location label, TLS baseline, minimal logging) before any switch.
- **G3.** Reject non-compliant destinations and show *why* in a reason code.
- **G4.** Simulate and handle three failures: process crash, network/link loss, service overload.
- **G5.** Measure downtime for each failover, with repeated runs.
- **G6.** Produce an audit timeline that shows failure, decision and failover in order.
- **G7.** Make the whole demo reproducible with a small number of commands.

### 3.2 Non-goals (from the brief, and our own limits)

- No production deployment.
- No legal compliance engine. We do not interpret laws such as data-residency statutes.
- No Internet-path residency guarantee. A location *label* is a configured/attested value, not geolocation, and we do not prove where packets travel.
- No high availability for the controller itself (single controller, restart on crash).
- No user authentication, rate limiting or multi-tenant features.
- No stateful session migration. Requests are stateless HTTP.

## 4. Users and stakeholders

| Stakeholder | What they need | How we serve them |
|---|---|---|
| **Mentor / evaluator** | See that every requirement in PS-006 is met; run or watch the demo; read the code and report | Traceability matrix (section 11), one-command demo, private repo shared with `aiori-hackathon` |
| **Team (demonstrators)** | A demo that works every time and is easy to explain in 3 minutes | Scenario runner, fixed demo script, timeline viewer |
| **Technical reader of the report** | Understand design, results and limits | Architecture and System Design docs, honest limitations section |

## 5. User stories

1. As the **mentor**, I want to inject a process crash and see traffic move to the other replica only if it is compliant, so that I can verify the policy gate works.
2. As the **mentor**, I want to see a failover refused when the other replica breaks the policy, together with the exact rule that failed.
3. As the **demonstrator**, I want one command per scenario that injects the fault, runs the probe, and prints the timeline and downtime.
4. As the **report reader**, I want downtime numbers from repeated runs (mean, p95, min, max) so that I can judge the result.
5. As a **reviewer**, I want the audit log to be tamper-evident and to contain only minimal fields, so that I can trust it and see that it respects data minimization.
6. As the **operator**, I want the controller to fail closed (return a clear 503) rather than route to a non-compliant replica.

## 6. Scope

### 6.1 In scope

- Two replicas of one small web service, with different location labels and TLS profiles.
- Lab certificate authority and per-replica certificates.
- Controller: reverse proxy, health monitor, policy engine, router, audit logger, admin API.
- Failure injectors for crash, link loss and overload.
- Probe client (50 ms) and downtime analyzer.
- Scenario runner and results artifacts.
- Documentation, PDF report in the required structure, pseudocode snippet.

### 6.2 Out of scope

- Real multi-region cloud deployment.
- DNS-based or anycast failover.
- Automatic failback with traffic-weighting.
- Controller clustering.

## 7. Functional requirements

Priority uses MoSCoW: **M** = Must, **S** = Should, **C** = Could.

### 7.1 Replicas and TLS

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-01 | Run the same small web service in two containers, Replica A and Replica B, each exposing `/health`, `/data` and `/meta` | M | Both containers start with `make up`; each endpoint returns 200 with the documented JSON |
| FR-02 | Each replica has a location label and its own TLS certificate issued by a lab CA | M | `/meta` returns the label; the certificate carries the same label in a SAN URI |
| FR-03 | Replicas serve HTTPS only; controller-to-replica traffic is TLS with certificate verification against the lab CA | M | Plain HTTP to a replica port fails; a connection with a wrong CA fails |
| FR-04 | Replica B can run in selectable profiles (compliant, wrong TLS, wrong location, label mismatch, verbose logging) | M | `REPLICA_B_PROFILE` changes B's behaviour after restart; each profile has a test |
| FR-05 | Controller front door accepts client traffic over HTTPS | S | Probe connects to the controller over TLS using the lab CA |

### 7.2 Controller, health and failover

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-10 | Clients talk only to the controller, which proxies to the active replica | M | Direct replica ports are not used by the probe; `X-Served-By` shows the active replica |
| FR-11 | Health monitor checks both replicas at a configurable interval (100 to 500 ms) | M | Interval is in config; logs show checks at that rate |
| FR-12 | A replica is *unhealthy* after N consecutive failed checks (default 2); failed means connect error, timeout, non-200, or latency above threshold (default 1000 ms) | M | Unit tests for the state machine; crash, link loss and overload each trigger it |
| FR-13 | Passive detection: a failed proxied request counts as a failure signal and triggers an immediate extra check | S | Crash is detected faster with passive detection than without (measured) |
| FR-14 | When the active replica becomes unhealthy, the controller evaluates the candidate against the policy and switches only on PASS | M | Scenarios S1 to S3 and S4 to S6 (section 9) |
| FR-15 | When the candidate fails policy (or is unhealthy), the controller refuses to switch, raises an alert, and returns 503 to clients (fail closed) | M | Scenario S4: probe sees 503; audit shows `failover_refused` with reason codes; zero requests served by the non-compliant replica |
| FR-16 | Every route change (failover, recovery, manual switch, startup) passes the policy gate | M | Audit shows a `policy_evaluated` PASS event immediately before each route change |
| FR-17 | If the service is in fail-closed state and a replica becomes healthy and compliant, the controller resumes service on it | S | Scenario S9 (recovery) |
| FR-18 | No automatic failback to the original replica once failed over (sticky active), to avoid flapping | S | Restarting A after a failover does not move traffic back |
| FR-19 | Optional `hold_and_retry` mode: for GET/HEAD, hold the request briefly and retry on the new active replica | C | Probe sees latency spike instead of failures |

### 7.3 Policy engine

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-20 | Policy lives in a plain YAML file, validated at load, with its SHA-256 recorded in the audit log | M | Invalid file is rejected with a clear message; audit shows `policy_loaded` with hash |
| FR-21 | Policy evaluation is a **pure, deterministic function** of (policy, observation). Same input always gives the same output, including the order of reason codes | M | Property test: 1000 repeated evaluations give identical results |
| FR-22 | Rules R1 to R6 (section 8) are implemented | M | One unit test per rule, plus combined cases |
| FR-23 | Result is PASS or FAIL plus a list of reason codes (all failing rules, not only the first) | M | A replica failing two rules shows two reason codes |
| FR-24 | Policy can be reloaded through the admin API without a restart; an invalid reload keeps the previous policy | S | Reload test with valid and invalid files |
| FR-25 | Optional TLS enforcement mode `no_legacy_support`: also verify that the replica *rejects* versions below the minimum | C | Replica accepting TLS 1.1 *and* 1.3 fails this mode but passes `negotiated` mode |

### 7.4 Audit and timeline

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-30 | Audit log is JSON Lines, one event per line, with UTC timestamp | M | File validates against the schema in System Design |
| FR-31 | Allowed fields are limited to timestamp, event, replica, decision, reason code, plus integrity metadata (sequence, previous hash, hash), run ID and a short policy hash. No client IPs, request paths, headers or payloads | M | Test injects a forbidden field and checks that it is dropped |
| FR-32 | Hash chain makes tampering detectable | S | `verify_audit` reports a broken chain after editing a line |
| FR-33 | Timeline viewer prints failure, decision and failover with time deltas | M | `make timeline` output matches the demo script |
| FR-34 | Events recorded: controller start, policy load, health state changes, failure detected, policy evaluated, failover done or refused, service unavailable and restored, admin actions | M | Scenario tests check the event order |

### 7.5 Failure injection, probe and measurement

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-40 | Injector for **process crash** (`docker stop`/`kill`) | M | Scenario S1 |
| FR-41 | Injector for **link loss** (`tc netem loss 100%`, fallback `docker network disconnect`) | M | Scenario S2 |
| FR-42 | Injector for **overload** (load generator plus resource limit; deterministic `degrade` toggle as fallback) | M | Scenario S3; latency threshold is exceeded |
| FR-43 | Every injector has `inject`, `verify` and `cleanup` steps and logs its own timestamp | M | Cleanup restores a clean state; two runs in a row give comparable results |
| FR-44 | Probe sends one request every 50 ms on a fixed schedule and logs each result | M | Probe log shows 20 requests per second with no drift |
| FR-45 | Analyzer computes downtime per run: time from the first failed request to the first successful request after it | M | Unit tests with synthetic logs; matches manual calculation |
| FR-46 | Scenario runner repeats each scenario N times (default 10) and reports mean, p50, p95, min and max | M | `results/matrix.csv` and `results/report.md` are generated |
| FR-47 | Each run stores audit log, injector log, probe log, summary JSON and timeline text | M | Files exist under `results/<run_id>/` |

### 7.6 Admin and deliverables

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-50 | Admin API: state, timeline, policy, reload, manual switch (still policy-gated); bound to loopback | S | Endpoints respond; admin port is not exposed externally |
| FR-51 | Minimal live dashboard page (state plus timeline) | C | Page updates during a scenario |
| FR-52 | Private GitHub repository named after the team, shared with `aiori-hackathon` | M | Repository exists with the correct name and collaborator |
| FR-53 | PDF report in the structure given in `Proposed-structure-hackathon.pdf`, committed to the repository | M | PDF present in repo |
| FR-54 | Prototype demonstration with a pseudocode snippet for the mentor | M | Live demo plus a one-page snippet |

## 8. Policy specification

The policy file expresses what a destination must satisfy. Rules are evaluated in fixed order and **all** failures are reported.

```yaml
version: 1
policy_id: lab-policy-001
allowed_locations: [IN]
location:
  require_cert_label_match: true     # label from /meta must equal label in the certificate
tls:
  min_version: "1.2"
  enforcement: negotiated            # negotiated | no_legacy_support
  require_trusted_cert: true
logging:
  mode: minimal                      # timestamp, event, replica, decision
  require_replica_minimal_logging: true
```

| Rule | Name | Passes when | Reason code on failure |
|---|---|---|---|
| R1 | Reachable | The candidate answers a TLS handshake and `/meta` within the timeout | `R1_UNREACHABLE` |
| R2 | Trusted certificate | Certificate chains to the lab CA, host name matches, and it is not expired | `R2_CERT_UNTRUSTED` |
| R3 | Location allowed | Declared location label is in `allowed_locations` | `R3_LOCATION_NOT_ALLOWED` |
| R4 | Label matches certificate | Label from `/meta` equals the label in the certificate SAN URI | `R4_LABEL_CERT_MISMATCH` |
| R5 | TLS baseline | Negotiated TLS version is at least `min_version` (and, in strict mode, older versions are rejected) | `R5_TLS_BELOW_MIN` |
| R6 | Minimal logging | Replica declares logging profile `minimal` | `R6_LOGGING_NOT_MINIMAL` |

Important honesty notes:

- **R3/R4** rely on a label that the lab configures and the certificate attests. This is *not* geolocation.
- **R6** relies on the replica's own declaration. It is an attested claim, not an inspection of the replica's logs.
- The controller's **own** audit log obeys the same minimal-logging rule through a field allow-list.

## 9. Failure scenarios and demo matrix

| ID | Failure | Replica B profile | Expected result | Required for demo |
|---|---|---|---|---|
| S1 | Process crash of A | `compliant` | Failover to B succeeds | Yes |
| S2 | Link loss to A | `compliant` | Failover to B succeeds | Yes |
| S3 | Overload of A | `eu_weak_tls` (EU label, TLS 1.1) | Failover refused (R3 + R5), 503 | Yes |
| S4 | Process crash of A | `weak_tls` (TLS 1.1 only) | Failover refused (R5) | Yes (policy rejection) |
| S5 | Link loss to A | `wrong_location` (EU label) | Failover refused (R3) | Report |
| S6 | Overload of A | `compliant` | Failover to B succeeds | Report |
| S7 | Process crash of A | `label_mismatch` | Refused (R4) | Report |
| S8 | Process crash of A | `verbose_logging` | Refused (R6) | Report |
| S9 | Crash, then A restarted while B was refused | `weak_tls` | Service restored on A after A passes policy | Report |

Slide 9 of the presentation shows S1, S2 and S3 as the three headline cases.

## 10. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Determinism | Policy decisions depend only on policy and observation. No hidden state, no randomness |
| NFR-02 | Safety invariant | The controller never forwards a client request to a replica whose latest policy evaluation was FAIL. Measured as `requests_served_by_noncompliant == 0` in every run |
| NFR-03 | Detection latency (design targets, to be validated) | Crash ≤ 1 s, link loss ≤ 2 s, overload ≤ 3 s from fault to detection under default settings. We report measured values, not targets |
| NFR-04 | Proxy overhead | Median added latency under 10 ms on localhost (target, validated by measurement) |
| NFR-05 | Reproducibility | `make demo` builds and runs everything on a clean Linux machine with Docker Compose v2 |
| NFR-06 | Privacy | Audit log contains only allow-listed fields (RFC 6973 data minimization) |
| NFR-07 | Security hygiene | Private keys are generated locally and never committed; admin API bound to loopback; fail closed on any policy uncertainty |
| NFR-08 | Observability | Every decision is explainable from the audit log alone |
| NFR-09 | Maintainability | Typed Python, unit tests for pure logic, one module per responsibility |
| NFR-10 | Measurement accuracy | Downtime resolution equals the probe interval (±50 ms); the report states this |

## 11. Traceability to the PS-006 brief

| Brief item | Requirement(s) | Component | Evidence |
|---|---|---|---|
| Two labelled lab replicas | FR-01, FR-02, FR-04 | `replicas/` | `/meta` output, certificates |
| TLS-enabled communication | FR-03, FR-05 | Replica and controller TLS contexts | Handshake test results |
| Simulate process crash | FR-40 | `injector/crash.sh` | S1, S4 results |
| Simulate link loss | FR-41 | `injector/linkloss.sh` | S2, S5 results |
| Simulate service overload | FR-42 | `injector/overload.sh` | S3, S6 results |
| Deterministic policy checks before failover | FR-14, FR-16, FR-21, FR-22 | `controller/policy.py` | Unit tests, audit events |
| Reject destinations violating location or TLS policy | FR-15, FR-23 | Policy engine, router | S3, S4, S5 refusal events |
| Measure downtime during each failover | FR-44, FR-45, FR-46 | `probe/` | `results/matrix.csv` |
| Audit timeline (failure, decision, failover) | FR-30 to FR-34 | `controller/audit.py` | `timeline.txt` per run |
| Policy enforcement module | FR-20 to FR-25 | `controller/policy.py` | Code and tests |
| Failover controller / orchestrator | FR-10 to FR-19 | `controller/` | Demo |
| Final demonstration and technical report | FR-52 to FR-54 | `docs/`, report PDF | Repo, PDF, demo |
| Private repo shared with aiori-hackathon | FR-52 | GitHub | Repo settings |
| Pseudocode snippet | FR-54 | `docs/pseudocode.md` | One-page snippet |

## 12. Success metrics

| Metric | Target |
|---|---|
| Compliant-target scenarios (S1, S2, S6), 10 runs each | 100% successful failover |
| Non-compliant-target scenarios (S3, S4, S5, S7, S8), 10 runs each | 100% refusal, correct reason code |
| Requests served by a non-compliant replica | 0 across all runs |
| Audit completeness | 100% of runs contain failure, decision and (failover or refusal) in order |
| Audit integrity | Hash chain verifies for 100% of runs |
| Decision determinism | Replaying recorded observations reproduces all decisions |
| Reproducibility | A teammate reproduces results from a clean clone in under 20 minutes |
| Downtime | Reported as mean, p50, p95, min, max per scenario. No target is promised before measurement |

## 13. Assumptions, constraints, dependencies

**Assumptions**

- The demo runs on a Linux machine (or VM) with Docker Engine and Docker Compose v2. The replicas, controller, injector and probe share one host and one clock, so timestamps are directly comparable.
- Python 3.12 and OpenSSL are available in the images.
- The mentor accepts a label-based location check for a lab demonstrator.

**Constraints**

- Small team (two people) and a short timeline.
- `tc netem` needs the `NET_ADMIN` capability inside the container.
- Modern OpenSSL builds disable TLS 1.0/1.1 by default; see risk R-01.

**Dependencies**

- Docker, OpenSSL, Python libraries (aiohttp, PyYAML, pytest, pytest-asyncio).

## 14. Risks and mitigations

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | TLS 1.1 cannot be negotiated on modern OpenSSL, so Replica B's weak TLS cannot be demonstrated or observed | Low (verified in a local Python spike on 2026-10-20; to be repeated inside the Docker image) | High | Repeat the spike in M0 inside the image. Fallback 1: cap B at TLS 1.2 and set policy minimum to 1.3. Fallback 2: build B on an older OpenSSL image. Update slides if the numbers change |
| R-02 | Overload is hard to make repeatable | Medium | Medium | Two variants: real load plus CPU limit, and a deterministic degrade toggle. Use the toggle for the headline runs |
| R-03 | `tc netem` unavailable in the environment | Medium | Medium | Fallback to `docker network disconnect` |
| R-04 | Downtime numbers vary between runs | High | Low | 10 repetitions, report mean and p95, state ±50 ms resolution |
| R-05 | Flapping (repeated switching) | Low | Medium | Consecutive-failure thresholds, sticky active, no automatic failback |
| R-06 | Time runs out | Medium | High | Build S1 end to end first; add S2 and S3 as variations (as the approach document advises) |
| R-07 | Label-based location is criticized as weak | Medium | Low | Say clearly it is a label attested by the certificate, not geolocation; this is within the brief's stated limits |
| R-08 | Docker is not available on the machine used for the demo | Low | High | Test the demo machine early; keep a recorded run as backup |

## 15. Milestones

| Milestone | Outcome | Exit criteria |
|---|---|---|
| M0 Spike | TLS 1.1 handshake, `tc netem`, and a minimal proxy proven | Written result of each spike |
| M1 Replicas and PKI | Two replicas with certificates and `/meta` | `make up` works; handshake tests pass |
| M2 Policy engine | Pure policy module with tests | All rule tests green |
| M3 Controller core | Proxy, monitor, router, audit | S1 works end to end |
| M4 Injectors, probe, analyzer | Three injectors, probe, downtime numbers | S1 to S3 produce numbers |
| M5 Scenario runner | Matrix of runs, results files | `make matrix` produces `matrix.csv` |
| M6 Polish | Timeline viewer, admin API, optional dashboard | Demo script rehearsed |
| M7 Report | PDF in the required structure, pseudocode, repo handover | Deliverables checklist complete |

Details and task breakdown are in the [MVP Tech Doc](MVP%20Tech%20Doc.md).

## 16. Deliverables checklist

- [ ] Private GitHub repository named `Algo-Ancesstors`
- [ ] `aiori-hackathon` added as collaborator; ownership transfer done after acceptance, as the brief describes
- [ ] PDF report in the required structure, committed to the repository
- [ ] Working prototype with all three failure scenarios
- [ ] Policy enforcement module with tests
- [ ] Audit timelines and downtime results for the demo scenarios
- [ ] Pseudocode snippet for the mentor
- [ ] Final demonstration

## 17. Open questions

1. Does the mentor expect the *client-to-controller* hop to use TLS, or is controller-to-replica TLS enough? (Our default: both.)
2. Should the logging rule also apply to the replicas, or only to the controller's own logging? (Our default: both, with the replica part being a declared claim.)
3. Is a single controller acceptable, or should we sketch a high-availability design in the report? (Our default: sketch only.)
4. Which TLS minimum should the final demo use: 1.2 as in the slides, or 1.3 if the TLS 1.1 spike fails?

## 18. Glossary

| Term | Meaning |
|---|---|
| Active replica | The replica currently receiving client traffic |
| Candidate | The replica that would receive traffic after a failover |
| Failover | Moving traffic from the active replica to the candidate |
| Fail closed | When unsure or when no compliant target exists, refuse service rather than route traffic |
| Policy gate | The check that must pass before any route change |
| Probe | A separate client that sends one request every 50 ms to measure downtime |
| Downtime | Time from the first failed probe request to the first successful one after it |
| Label | A configured location tag (for example `IN`, `EU`) attested in the replica's certificate |
| Audit timeline | Ordered record of failure, decision and failover events |

## 19. References

- RFC 6973, *Privacy Considerations for Internet Protocols* (data minimization, section 6.1)
- RFC 8446, *The Transport Layer Security (TLS) Protocol Version 1.3*
- RFC 9325, *Recommendations for Secure Use of TLS and DTLS*
- RFC 8996, *Deprecating TLS 1.0 and TLS 1.1*
- RFC 5280, *Internet X.509 Public Key Infrastructure Certificate and CRL Profile*
- PS-006 problem statement and the team's approach document (A3-PS006-TC329)
