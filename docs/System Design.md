# System Design

**Project:** PS-006 Policy-Constrained Service Failover Demonstrator
**Team:** Algo-Ancesstors (`A3-PS006-TC329`), AIORI Hackathon 3
**Authors:** Ankur Pratap Singh, Dev Saraswat
**Version:** 0.1 (draft)   **Date:** 2026-10-20

Related documents: [PRD](PRD.md) · [Architecture](Architecture.md) · [MVP Tech Doc](MVP%20Tech%20Doc.md)

---

## 1. Purpose and scope

The [Architecture](Architecture.md) explains the parts and the reasons for them. This document defines **how each part works**: modules, data structures, algorithms, interfaces, schemas, TLS and PKI details, fault injection procedures, the timing model, and the test strategy. The [MVP Tech Doc](MVP%20Tech%20Doc.md) turns this design into a build plan with code skeletons.

## 2. Design inputs and verified facts

### 2.1 Constraints taken from the brief

- Two labelled replicas, TLS-enabled communication.
- Three failures: process crash, network/link loss, service overload.
- Deterministic policy checks before failover; reject on location or TLS violation; limited diagnostic logging.
- Downtime measured for each failover; audit timeline; policy rejection results.
- Lab only: no production deployment, no legal compliance engine, no Internet-path residency guarantee.

### 2.2 Result of the TLS spike (verified on 2026-10-20)

Because weak TLS is central to the demo, we tested it before finalizing the design. Environment: Python 3.13 with OpenSSL 3.0.13.

| Test | Result |
|---|---|
| Python TLS server restricted to TLS 1.1 only, observer client with `minimum_version = TLSv1` and `ALL:@SECLEVEL=0` | Handshake succeeded; `ssl_object.version()` returned `TLSv1.1` |
| Same observer against a TLS 1.2 to 1.3 server | Negotiated `TLSv1.3` |
| Data-path client with `minimum_version = TLSv1_2` against the TLS 1.1 server | Refused with `TLSV1_ALERT_PROTOCOL_VERSION` |
| Certificate SAN URI (`urn:aiori-lab:location:EU`) read through `getpeercert()` | Worked, returned as `('URI', ...)` entries |

**Consequences for the design**

1. Replicas and the controller can use **Python's `ssl` module directly** with explicit protocol limits. We do not need nginx.
2. The observer can *see* a weak replica; the data path can *refuse* it. This is the two-context design (ADR-12).
3. Some distributions (Debian and derivatives) set `MinProtocol = TLSv1.2` in the system OpenSSL config. If a given base image blocks the explicit setting, the fix is an `OPENSSL_CONF` override file (section 8.5). We also keep the PRD fallbacks (TLS 1.2 cap with policy minimum 1.3).
4. With `aiohttp`, a strict client rejected by a TLS 1.1 server sees a connection reset rather than a named TLS error (verified in the local tests), so the health reason for such a replica can read `CONNECT_ERROR`.
5. Python marks `TLSVersion.TLSv1_1` as deprecated and prints a `DeprecationWarning`. This is expected and is filtered in the replica code.

The spike was a TLS-level test only. Docker, `tc netem` and the full controller are not yet exercised; the MVP milestones M0 to M1 cover them.

### 2.3 Technology choices

| Area | Choice | Notes |
|---|---|---|
| Language | Python 3.12+ | Standard `ssl`, `asyncio`, `hashlib`, `json` |
| HTTP server and client | `aiohttp` | Accepts a full `ssl.SSLContext`, so protocol limits are exact |
| Config | PyYAML | Policy and controller config |
| Tests | pytest, pytest-asyncio | |
| Containers | Docker Engine, Compose v2 | |
| PKI | OpenSSL CLI | Lab CA and leaf certificates |
| Faults | `docker kill/stop`, `tc netem`, `docker network disconnect`, load generator (`hey` or a small Python load script) | |

## 3. Module decomposition

```
controller/
  app/
    main.py          wiring, start/stop, signal handling
    config.py        load and validate controller.yaml
    policy.py        Policy model, loader, evaluate()  [pure]
    observer.py      TLS handshake + /meta + cert parsing  [I/O]
    monitor.py       health checks, health state machine, passive signals
    manager.py       FailoverManager: state machine, policy gate, RouteTable
    frontdoor.py     HTTPS reverse proxy, upstream sessions
    audit.py         allow-list, hash chain, JSONL writer, verifier
    admin.py         admin API handlers
    models.py        dataclasses and enums (Observation, Decision, ...)
replicas/
  app/server.py      aiohttp app, TLS context from profile
  profiles.yaml      profile table
probe/
  probe.py           fixed-schedule client
  analyze.py         downtime computation, stats
injector/
  crash.sh  linkloss.sh  overload.sh  lib.sh
scenarios/
  runner.py          orchestrates a run, repeats, aggregates
  scenarios.yaml     S1 to S9
tools/
  timeline.py        merge and print audit + injector logs
  verify_audit.py    chain verification
certs/
  gen_certs.sh
```

**Dependency rules**

- `policy.py` imports nothing from the rest of the app and does no I/O. It depends only on `models.py` types.
- `observer.py` returns an `Observation`; it never decides.
- `manager.py` is the only module that changes the active replica.
- `audit.py` is called by `monitor`, `manager` and `admin`, and never calls back.
- `frontdoor.py` reads an immutable `RouteTable` and reports failures to `monitor`; it never changes routing.

## 4. Core data structures

```python
class Health(Enum):  UNKNOWN, HEALTHY, UNHEALTHY
class Mode(Enum):    STARTING, SERVING, EVALUATING, UNAVAILABLE

@dataclass(frozen=True)
class RouteTable:            # swapped atomically; read by the front door without locks
    mode: Mode
    active: str | None       # "A" | "B" | None
    epoch: int               # +1 on every switch

@dataclass(frozen=True)
class Observation:
    replica_id: str
    reachable: bool                  # handshake and GET /meta succeeded
    cert_trusted: bool               # chain, host name and validity accepted by the TLS stack
    tls_version: str | None          # "1.0" | "1.1" | "1.2" | "1.3"
    declared_location: str | None    # from /meta
    cert_location: str | None        # from SAN URI urn:aiori-lab:location:<LABEL>
    declared_logging: str | None     # from /meta: "minimal" | "verbose"
    legacy_accepted: tuple[str, ...] | None   # versions below the minimum that the replica accepted; None if not probed

@dataclass(frozen=True)
class Decision:
    replica_id: str
    passed: bool
    reasons: tuple[str, ...]         # ordered by rule number, e.g. ("R3_LOCATION_NOT_ALLOWED", "R5_TLS_BELOW_MIN")
    policy_id: str
    policy_sha: str                  # first 12 hex characters of the policy file's SHA-256
```

## 5. Algorithms

### 5.1 Single health check

```
check(replica):
    start = monotonic()
    try:
        status = GET https://replica/health with
                 connect_timeout = connect_timeout_ms
                 read_timeout    = read_timeout_ms
                 TLS context     = data-path context (min TLS 1.2, verify against lab CA)
    except ConnectionRefused:        return (False, "CONNECT_REFUSED", elapsed)
    except ConnectTimeout:           return (False, "CONNECT_TIMEOUT", elapsed)
    except OtherConnectError (DNS):  return (False, "CONNECT_ERROR", elapsed)
    except ReadTimeout:              return (False, "READ_TIMEOUT", elapsed)
    except TLSError:                 return (False, "TLS_ERROR", elapsed)
    elapsed = monotonic() - start
    if status != 200:                return (False, "HTTP_STATUS", elapsed)
    if elapsed > latency_threshold:  return (False, "LATENCY_EXCEEDED", elapsed)
    return (True, "-", elapsed)
```

Notes:

- Health checks use the **strict data-path context**. A replica that only speaks TLS 1.1 therefore also looks unhealthy to the data path, which is correct: traffic could not flow to it anyway. Depending on how the TLS stack reports the protocol alert, the reason is `TLS_ERROR` or, when the peer simply resets the connection (what `aiohttp` reports in our tests), `CONNECT_ERROR`. The observer (section 5.3) is what explains *why* it is non-compliant.
- A stopped container may produce a DNS-level error instead of a refused connection, because Docker removes the name when the container is gone. That is classified as `CONNECT_ERROR`. Both cases count as crash-type failures.

### 5.2 Health state machine (per replica)

```
state: UNKNOWN | HEALTHY | UNHEALTHY
counters: consecutive_fail, consecutive_ok

on result(ok, reason):
    if ok:  consecutive_ok += 1; consecutive_fail = 0
    else:   consecutive_fail += 1; consecutive_ok = 0; last_reason = reason

    if state in (UNKNOWN, HEALTHY) and consecutive_fail >= failure_threshold:  -> UNHEALTHY  (emit event)
    if state == UNKNOWN and consecutive_ok >= 1:                              -> HEALTHY    (emit event)
    if state == UNHEALTHY and consecutive_ok >= recovery_threshold:           -> HEALTHY    (emit event)

on passive_failure(reason):                 # from the front door
    consecutive_fail += 1; consecutive_ok = 0; last_reason = reason
    trigger an immediate active check (skip the wait for the next tick)
    apply the same threshold rule
```

Defaults: `failure_threshold = 2`, `recovery_threshold = 3`, `interval = 100 ms`. Recovery needs more successes than failure needs failures, which prevents flapping.

### 5.3 Observation and policy evaluation

**Observer** (I/O, one call per decision):

```
observe(replica):
    # step 1: verified handshake, with a context that allows legacy versions
    try:
        conn = TLS connect(verify=lab CA, host name check, min=TLS1.0, max=TLS1.3, ciphers "ALL:@SECLEVEL=0")
    except CertificateVerifyError:  return Observation(reachable=True, cert_trusted=False, ...all None)
    except any connect/timeout:     return Observation(reachable=False, ...)
    tls_version = conn.version()                       # "TLSv1.1" -> "1.1"
    cert_location = parse SAN URI "urn:aiori-lab:location:<X>" -> X (None if absent)
    meta = GET /meta over this connection (timeout) -> declared_location, declared_logging
    # step 2 (only if enforcement == no_legacy_support):
    legacy_accepted = [v for v in versions below min_version if handshake succeeds with min=max=v]
    return Observation(...)
```

Principle: **evidence from an untrusted peer is not evidence.** If the certificate is not trusted, the observer does not read `/meta` from that peer.

**Policy evaluation** (pure):

```
evaluate(policy, obs) -> Decision:
    if not obs.reachable:      return FAIL(["R1_UNREACHABLE"])
    if not obs.cert_trusted:   return FAIL(["R2_CERT_UNTRUSTED"])
    reasons = []
    if obs.declared_location not in policy.allowed_locations:              reasons += ["R3_LOCATION_NOT_ALLOWED"]
    if policy.location.require_cert_label_match
       and obs.declared_location != obs.cert_location:                     reasons += ["R4_LABEL_CERT_MISMATCH"]
    if obs.tls_version is None or version(obs.tls_version) < version(policy.tls.min_version):
                                                                           reasons += ["R5_TLS_BELOW_MIN"]
    elif policy.tls.enforcement == "no_legacy_support" and obs.legacy_accepted:
                                                                           reasons += ["R5_TLS_BELOW_MIN"]
    if policy.logging.require_replica_minimal_logging
       and obs.declared_logging != "minimal":                              reasons += ["R6_LOGGING_NOT_MINIMAL"]
    return PASS if not reasons else FAIL(reasons)       # reasons already in rule order
```

**Determinism rules**

1. No clock, randomness, environment access or network call inside `evaluate`.
2. Rules are evaluated in fixed order R1 to R6; reasons appear in that order.
3. Missing data counts as failure for the rule that needs it (never as success).
4. Versions are compared as integer tuples, never as strings.
5. The policy object is immutable after loading.

**Why R3 uses only the declared label.** R3 asks "is the label allowed?". R4 asks "does the label match the certificate?". Keeping them separate gives clear reason codes. Because any mismatch fails R4, a replica cannot pass by declaring an allowed label that its certificate contradicts.

### 5.4 Failover manager

```
events processed one at a time from an asyncio.Queue (health transitions, admin requests, periodic tick)

on startup:
    for candidate in [initial_active, other]:
        d = gate(candidate)
        if d.passed and health(candidate) in (HEALTHY, UNKNOWN->wait for first check):
            set_route(SERVING, candidate)  ; return
    set_route(UNAVAILABLE, None) ; emit service_unavailable

on active_unhealthy(active):
    emit failure_detected(active, reason)
    set_route(EVALUATING, active)                 # requests fail fast or are held
    candidate = other(active)
    d = gate(candidate)                           # fresh observation, bounded by decision_timeout_ms
    if d.passed and health(candidate) == HEALTHY:
        epoch += 1 ; set_route(SERVING, candidate) ; emit failover_done(candidate)
    else:
        emit failover_refused(candidate, d.reasons or "R1_UNREACHABLE") ; alert()
        set_route(UNAVAILABLE, None) ; emit service_unavailable

on replica_healthy(r) while mode == UNAVAILABLE:
    d = gate(r)
    if d.passed: epoch += 1 ; set_route(SERVING, r) ; emit service_restored(r)

on periodic_tick while mode == UNAVAILABLE (every reevaluate_interval_ms):
    for r in replicas that are HEALTHY: try the same as above      # catches policy reloads and slow recovery

on admin_switch(to):
    d = gate(to)                                  # manual switches use the same gate
    apply as in failover, emit admin_switch_requested

gate(r):
    obs = observer.observe(r)                     # may time out -> unreachable
    d = policy.evaluate(current_policy, obs)
    emit policy_evaluated(r, PASS|FAIL, reasons)
    return d
```

Rules:

- A `policy_evaluated` event **always precedes** a route change. The analyzer checks this order for every run (safety property SI-2).
- The active replica is not re-evaluated while it is serving (the brief asks for checks before failover). Optional hardening: periodically re-evaluate the active replica too and fail closed if it stops being compliant. This is listed under stretch goals.
- Sticky active: after A fails and B takes over, nothing moves traffic back to A unless B fails and A passes the gate.

### 5.5 Request path (front door)

```
handle(request):
    rt = route_table                               # atomic read of an immutable object
    if rt.mode != SERVING:
        return 503 {"error": "no_compliant_replica", "epoch": rt.epoch}
    try:
        resp = await upstream[rt.active].forward(request)       # strict data-path TLS, timeouts
    except Exception as e:
        monitor.passive_failure(rt.active, classify(e))
        if failover.mode == "hold_and_retry" and request.method in (GET, HEAD):
            new = await wait_for_route_change(rt.epoch, hold_ms)
            if new.mode == SERVING: return await forward_once(new.active, request)
        return 502 {"error": "upstream_failure"}
    if resp.status >= 500: monitor.passive_failure(rt.active, "HTTP_STATUS")
    add headers  X-Served-By: rt.active  and  X-Failover-Epoch: rt.epoch
    return resp
```

Notes:

- In the default `strict` mode the client sees the failure, which makes the measured downtime meaningful. `hold_and_retry` converts failures into a latency spike; the analyzer then reports **stall time** (largest latency) in addition to downtime.
- Only GET and HEAD are ever retried. Other methods are never replayed.
- No request body, path, query, header or client address is written to any log.

### 5.6 Downtime computation

Probe records are sorted by send time. A record is *successful* if the status is 200 and `X-Served-By` is present.

```
outages = []
i = 0
while i < n:
    if not ok[i]:
        j = first index > i with ok[j]
        if exists j:  outages.append( start=t_send[i], end=t_send[j], downtime_ms=(t_send[j]-t_send[i])/1e6, open=False )
        else:         outages.append( start=t_send[i], end=t_send[last], downtime_ms=(t_send[last]-t_send[i])/1e6, open=True )
        i = j or n
    else: i += 1

primary_outage = first outage whose start >= fault_injected_ts - one probe interval
```

- Resolution is one probe interval (50 ms): the true downtime lies within about ±50 ms of the reported value.
- An **open** outage (no later success) is expected in refusal scenarios. It is reported as `service_restored = false` with the observed duration until the end of the run.
- The analyzer also reports `failed_requests` (count inside the outage) and `served_by_noncompliant` (count of successes whose `served_by` is a replica that was in FAIL state at that moment; must be 0).
- Per scenario, repeated runs are summarized as mean, p50, p95, min, max and count.

## 6. Interfaces

### 6.1 Replica API (HTTPS, port 8443)

| Method and path | Response | Purpose |
|---|---|---|
| `GET /health` | `200 {"status":"ok","replica":"A"}` | Health check |
| `GET /data` | `200 {"replica":"A","seq":123,"payload":"<~200 bytes>"}` and header `X-Replica: A` | Client traffic |
| `GET /meta` | `200 {"replica":"A","location":"IN","logging":"minimal","profile":"compliant"}` | Declared label and logging profile; `tls_min`/`tls_max` may be included as informational fields but are **never** used by the policy (policy uses the observed handshake) |
| `POST /lab/degrade` | `200 {"delay_ms":N}` | Lab-only: add artificial delay to every response (deterministic overload). Requires header `X-Lab-Token` |
| `POST /lab/reset` | `200` | Lab-only: clear degradation |

The replica does not write access logs (consistent with the minimal logging rule). It logs only startup and errors.

### 6.2 Controller data plane (HTTPS, port 8443)

- Any path is proxied to the active replica.
- Response headers added: `X-Served-By`, `X-Failover-Epoch`.
- Failure responses:

| Situation | Status | Body |
|---|---|---|
| No compliant healthy replica (fail closed) | 503 | `{"error":"no_compliant_replica","epoch":N}` |
| Upstream failure while evaluating | 502 | `{"error":"upstream_failure"}` |

### 6.3 Admin API (HTTP, `127.0.0.1:9000`)

Inside the container the admin listener binds `0.0.0.0`; Docker Compose publishes it to the host's loopback only.

| Method and path | Description |
|---|---|
| `GET /admin/state` | Current mode, active, epoch, per-replica health and last policy decision, policy id and hash, run id |
| `GET /admin/timeline?limit=N` | Last N audit events |
| `GET /admin/policy` | Loaded policy (parsed) and hash |
| `POST /admin/policy/reload` | Re-read the policy file; invalid file keeps the previous policy |
| `POST /admin/switch` with `{"to":"B"}` | Request a manual switch; passes the policy gate |
| `POST /admin/reset` with `{"run_id":"..."}` | Lab-only: start a new run (new audit file, reset state, re-run startup logic) |

Example `GET /admin/state`:

```json
{
  "run_id": "S1-r03",
  "mode": "SERVING",
  "active": "B",
  "epoch": 1,
  "policy": {"id": "lab-policy-001", "sha": "9f2c1a7be340"},
  "replicas": {
    "A": {"health": "UNHEALTHY", "reason": "CONNECT_ERROR", "last_latency_ms": null,
          "last_decision": null},
    "B": {"health": "HEALTHY", "reason": "-", "last_latency_ms": 3.2,
          "last_decision": {"passed": true, "reasons": [], "age_ms": 41}}
  }
}
```

## 7. Schemas and files

### 7.1 `policy.yaml`

| Key | Type | Allowed values | Default |
|---|---|---|---|
| `version` | int | `1` | required |
| `policy_id` | string | non-empty | required |
| `allowed_locations` | list of strings | non-empty, uppercase labels | required |
| `location.require_cert_label_match` | bool | | `true` |
| `tls.min_version` | string | `"1.0"`, `"1.1"`, `"1.2"`, `"1.3"` | `"1.2"` |
| `tls.enforcement` | string | `negotiated`, `no_legacy_support` | `negotiated` |
| `tls.require_trusted_cert` | bool | must be `true` in the MVP (R2 is always on) | `true` |
| `logging.mode` | string | `minimal` | `minimal` |
| `logging.require_replica_minimal_logging` | bool | | `true` |

Unknown keys are rejected so that typos cannot silently disable a rule.

### 7.2 `controller.yaml`

| Key | Default | Meaning |
|---|---|---|
| `listen.host`, `listen.port` | `0.0.0.0`, `8443` | Front door |
| `listen.tls.cert`, `listen.tls.key` | `/certs/controller.crt`, `.key` | Front-door certificate |
| `admin.host`, `admin.port` | `127.0.0.1`, `9000` | Admin API |
| `replicas[].id`, `.url`, `.sni` | `A`/`B`, `https://replica-a:8443`, `replica-a` | Replica list |
| `initial_active` | `A` | Preferred replica at startup |
| `tls.ca_file` | `/certs/ca.crt` | Trust anchor |
| `tls.data_path_min_version` | `1.2` | Floor for data-path and health TLS |
| `health.interval_ms` | `100` (allowed 100 to 500) | Check interval |
| `health.connect_timeout_ms` | `250` | |
| `health.read_timeout_ms` | `1500` | |
| `health.latency_threshold_ms` | `1000` | Overload threshold |
| `health.failure_threshold` | `2` | |
| `health.recovery_threshold` | `3` | |
| `failover.mode` | `strict` | `strict` or `hold_and_retry` |
| `failover.hold_ms` | `1500` | Only for `hold_and_retry` |
| `failover.decision_timeout_ms` | `500` | Bound on one observation |
| `failover.reevaluate_interval_ms` | `2000` | While unavailable |
| `upstream.connect_timeout_ms`, `upstream.read_timeout_ms` | `250`, `1000` | Data-path timeouts |
| `audit.dir` | `/results` | Audit files are written under `<dir>/<run_id>/audit.jsonl` |
| `policy_file` | `/policy/policy.yaml` | |

### 7.3 Audit event (JSON Lines)

```json
{"seq":7,"ts":"2026-10-20T10:15:30.123456Z","run_id":"S1-r03","event":"policy_evaluated",
 "replica":"B","decision":"PASS","reason":"-","policy":"9f2c1a7be340",
 "prev":"<64 hex>","hash":"<64 hex>"}
```

| Field | Type | Notes |
|---|---|---|
| `seq` | int | Starts at 1 in each run file |
| `ts` | string | UTC ISO 8601, microsecond resolution |
| `run_id` | string | Scenario and repeat |
| `event` | enum | `controller_started`, `policy_loaded`, `policy_load_failed`, `health_changed`, `failure_detected`, `policy_evaluated`, `failover_done`, `failover_refused`, `service_unavailable`, `service_restored`, `admin_switch_requested`, `fault_injected`, `fault_cleared` |
| `replica` | `A`, `B` or `-` | |
| `decision` | enum | `HEALTHY`, `UNHEALTHY`, `PASS`, `FAIL`, `SWITCHED`, `REFUSED`, `UP`, `DOWN`, `-` |
| `reason` | string | Only enumerated codes, joined with `+` in rule order (for example `R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN`); `-` when not applicable |
| `policy` | string | First 12 hex characters of the policy SHA-256 (only on policy-related events; otherwise `-`) |
| `prev`, `hash` | hex string | Chain: `hash = SHA256(prev + canonical_json({seq, ts, run_id, event, replica, decision, reason, policy}))`; canonical JSON uses sorted keys and compact separators; first `prev` is 64 zeros |

**Allow-list.** The logger accepts exactly the fields above. Any other key is dropped before writing. There is no free-text message field. This is the implementation of `logging: minimal` for the controller and is tested (TS-U-31).

**Injector events** (`fault_injected`, `fault_cleared`) are written by the injector to `injector.jsonl` with the same schema (without chain fields), and merged by the timeline tool using timestamps. Their `reason` is `FAULT_CRASH`, `FAULT_LINKLOSS` or `FAULT_OVERLOAD`.

### 7.4 Probe record (`probe.jsonl`)

```json
{"seq":412,"t_send_ns":1760955330123456789,"t_recv_ns":1760955330128002000,
 "status":200,"ok":true,"latency_ms":4.5,"served_by":"A","epoch":0,"error":null}
```

`error` is one of `null`, `timeout`, `conn_error`, `tls_error`, `http_status`.

### 7.5 Run summary (`summary.json`)

| Field | Meaning |
|---|---|
| `run_id`, `scenario`, `repeat`, `b_profile` | Identity |
| `t_fault_ts` | When the injector applied the fault |
| `t_detect_ts`, `t_decision_ts`, `t_switch_ts` | From audit events `failure_detected`, `policy_evaluated`, `failover_done`/`failover_refused` |
| `detect_ms`, `decide_ms`, `switch_ms` | Differences between the stamps |
| `outcome` | `FAILOVER` or `REFUSED` |
| `reasons` | Policy reason codes when refused |
| `downtime_ms`, `outage_open`, `failed_requests` | From the probe |
| `served_by_noncompliant` | Must be 0 |
| `audit_chain_ok`, `audit_order_ok` | Verifier results |

Aggregates: `results/matrix.csv` has one row per scenario with count, mean, p50, p95, min and max of `downtime_ms`, plus success and refusal counts.

## 8. TLS and PKI design

### 8.1 Certificates

| Certificate | Subject CN | SAN | Notes |
|---|---|---|---|
| Lab CA | `Algo-Ancesstors Lab CA` | | Self-signed, 10-day validity, key generated locally |
| Controller | `controller` | `DNS:controller`, `DNS:localhost` | Used for the front door |
| Replica A | `replica-a` | `DNS:replica-a`, `URI:urn:aiori-lab:location:IN` | |
| Replica B (IN) | `replica-b` | `DNS:replica-b`, `URI:urn:aiori-lab:location:IN` | Used by `compliant`, `weak_tls`, `verbose_logging` |
| Replica B (EU) | `replica-b` | `DNS:replica-b`, `URI:urn:aiori-lab:location:EU` | Used by `eu_weak_tls`, `wrong_location`, `label_mismatch` |

`gen_certs.sh` runs these steps (RSA 2048 is enough for a lab; EC P-256 is an alternative):

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 10 -subj "/CN=Algo-Ancesstors Lab CA"
# for each leaf: key, CSR, then sign with an extension file
openssl req -newkey rsa:2048 -nodes -keyout replica-a.key -out replica-a.csr -subj "/CN=replica-a"
printf 'subjectAltName=DNS:replica-a,URI:urn:aiori-lab:location:IN\n' > replica-a.ext
openssl x509 -req -in replica-a.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out replica-a.crt -days 10 -extfile replica-a.ext
```

`gen_certs.sh` produces four replica certificates (`replica-a-in`, `replica-a-eu`, `replica-b-in`, `replica-b-eu`); a replica's profile selects the one it uses. The CA certificate carries `basicConstraints=CA:TRUE` and `keyUsage=keyCertSign` (strict clients such as Python 3.13's default context reject a CA without them), and leaf certificates carry `extendedKeyUsage=serverAuth`.

Keys and the CA key stay in `certs/` on the host, are listed in `.gitignore`, and are mounted read-only into containers.

### 8.2 Replica profiles

| Profile | `/meta` location | Certificate label | TLS range | Declared logging | Expected result |
|---|---|---|---|---|---|
| `compliant` | IN | IN | 1.2 to 1.3 | minimal | PASS |
| `weak_tls` | IN | IN | 1.1 only | minimal | `R5_TLS_BELOW_MIN` |
| `eu_weak_tls` (the deck's default "wrong" replica) | EU | EU | 1.1 only | minimal | `R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN` |
| `wrong_location` | EU | EU | 1.2 to 1.3 | minimal | `R3_LOCATION_NOT_ALLOWED` |
| `label_mismatch` | IN | EU | 1.2 to 1.3 | minimal | `R4_LABEL_CERT_MISMATCH` |
| `verbose_logging` | IN | IN | 1.2 to 1.3 | verbose | `R6_LOGGING_NOT_MINIMAL` |

Replica A always runs `compliant`. Replica B's profile is a run parameter (`REPLICA_B_PROFILE`), applied by recreating the container.

Note on `weak_tls`: under the controller's strict data-path context, B is also unhealthy for the health check (`TLS_ERROR` or `CONNECT_ERROR`). The *policy* decision therefore reports the real reason through the observer, which uses the legacy-tolerant context.

### 8.3 Two TLS contexts in the controller

| | Observer context | Data-path context |
|---|---|---|
| Used for | Policy observation only | Health checks and all proxied traffic |
| Versions | min TLS 1.0, max TLS 1.3 | min TLS 1.2, max TLS 1.3 |
| Ciphers | `ALL:@SECLEVEL=0` (so weak servers can be seen) | Library defaults |
| Verification | CA, host name, validity | CA, host name, validity |
| Reads application data from peer | Only `/meta`, and only after the certificate is trusted | Yes |

Even if the policy engine had a bug, the data-path context would still refuse a TLS 1.1 replica. This is deliberate defence in depth.

### 8.4 Replica TLS

Each replica builds an `ssl.SSLContext(PROTOCOL_TLS_SERVER)`, loads its certificate, then sets `minimum_version` and `maximum_version` from its profile (and `ALL:@SECLEVEL=0` ciphers for TLS 1.1 profiles). `aiohttp.web.run_app(app, ssl_context=ctx)` serves HTTPS.

### 8.5 If a base image blocks legacy TLS

Create `legacy-openssl.cnf` and set `OPENSSL_CONF` for the affected containers:

```
openssl_conf = openssl_init
[openssl_init]
ssl_conf = ssl_sect
[ssl_sect]
system_default = system_default_sect
[system_default_sect]
MinProtocol = TLSv1
CipherString = ALL:@SECLEVEL=0
```

If that still fails, use the PRD fallbacks: cap B at TLS 1.2 and set `tls.min_version: "1.3"`, or use an image with an older OpenSSL.

## 9. Fault injection design

Each injector offers `inject`, `verify` and `cleanup`, logs its own timestamp to `injector.jsonl`, and is idempotent.

| Scenario type | Inject | Verify (injector side) | Cleanup | Expected detection reason |
|---|---|---|---|---|
| **Process crash** | `docker kill replica-a` (SIGKILL). Variant: kill only the app process inside the container | Container is not running, or port closed | `docker compose up -d --force-recreate replica-a` and wait for `/health` | `CONNECT_ERROR` or `CONNECT_REFUSED` (container kill); `HTTP_STATUS`/`CONNECT_REFUSED` for app-only kill |
| **Link loss** | Preferred: `docker exec replica-a tc qdisc add dev eth0 root netem loss 100%` (needs `NET_ADMIN` and `iproute2`). Fallback: `docker network disconnect lab-net replica-a` | `tc qdisc show` contains `netem`, or the container has no network | `tc qdisc del dev eth0 root` or `docker network connect lab-net replica-a` | `CONNECT_TIMEOUT` or `READ_TIMEOUT` |
| **Overload** (deterministic) | `POST /lab/degrade {"delay_ms":2500}` on replica A | A request to `/health` takes longer than the threshold | `POST /lab/reset` | `LATENCY_EXCEEDED` |
| **Overload** (realistic) | `docker update --cpus 0.2 replica-a`, then a load generator (`hey -c 100 -z 20s` or the bundled script) against replica A's published port; `/data` performs a small CPU task | Measured `/health` latency above threshold | Stop the load, `docker update --cpus 0 replica-a` (remove the limit) | `LATENCY_EXCEEDED`, possibly `READ_TIMEOUT` |

Guidance:

- Use the **deterministic** overload variant for the headline runs, and show the **realistic** variant once to demonstrate that the threshold also triggers under real load.
- Between repeats, the runner recreates both replicas and calls `/admin/reset`, so every run starts from the same state.
- The injector writes `fault_injected` at the moment the command returns success, which defines `t_fault_ts`.

## 10. Timing model

### 10.1 Components of downtime

```
downtime ≈ T_detect + T_decide + T_switch + quantization
```

| Term | Meaning | Depends on |
|---|---|---|
| `T_detect` | From fault to the `failure_detected` event | Check interval, failure threshold, timeouts, passive signals |
| `T_decide` | Observation plus policy evaluation | One TLS handshake and one `GET /meta` on the local network, bounded by `decision_timeout_ms` |
| `T_switch` | Replacing the route table | Microseconds |
| quantization | Probe schedule | Up to one probe interval (50 ms) at each end |

### 10.2 Design estimates with defaults (to be replaced by measurements)

| Failure | Detection mechanism | Estimated `T_detect` | Notes |
|---|---|---|---|
| Crash | Connect error is immediate. Two failures at 100 ms intervals, or one failed proxied request plus one immediate check | roughly 0.1 to 0.3 s | Passive detection helps most here |
| Link loss | Connect timeout of 250 ms, two consecutive failures | roughly 0.6 to 1.0 s | Existing keep-alive connections may hang until the upstream read timeout (1 s) |
| Overload | Latency above 1000 ms, two consecutive failures | roughly 2 to 3.5 s | Dominated by the latency threshold |

These are planning numbers, not results. The report will quote only what the probe measures, with mean, p95 and the ±50 ms resolution.

### 10.3 Timestamps and clocks

All components run on one host, so wall-clock stamps (`time.time_ns()`) are directly comparable across processes. Durations inside a process use `time.monotonic()` or `perf_counter_ns()`. The timeline tool orders events by wall-clock stamp.

## 11. Concurrency and consistency

- The controller runs in **one asyncio event loop**. All state transitions happen inside a single manager task that consumes an event queue. This serializes decisions and removes the need for fine-grained locks.
- The route table is an **immutable object replaced atomically**. The front door reads it without locking, so a request either sees the old table or the new one, never a mixture.
- **Epoch** increments on every switch. Responses carry `X-Failover-Epoch`, which lets the probe and the analyzer correlate requests with decisions.
- **No split brain**: only the manager sets the route; there is one manager.
- In-flight requests on the old upstream complete or fail on their own; they are not migrated.
- `AuditLog.emit()` is synchronous and contains no `await`, so assigning `seq`, chaining the hash and writing the line is atomic with respect to the event loop.
- Blocking calls (file writes) are small; if needed they run in an executor to protect the event loop.

## 12. Error handling matrix

| Error | Where | Handling | Audit |
|---|---|---|---|
| Replica connect or TLS error during health check | monitor | Count as failure with a reason code | `health_changed` on threshold |
| Observation times out | observer | Treat as unreachable (R1) | `policy_evaluated FAIL R1_UNREACHABLE` |
| Certificate verification fails | observer | `cert_trusted = False`, no `/meta` read | `FAIL R2_CERT_UNTRUSTED` |
| Policy file missing or invalid at start | config/policy | Exit with a clear console error | none (no run yet) |
| Policy file invalid on reload | admin | Keep previous policy | `policy_load_failed` |
| Audit write fails | audit | Stop making switching decisions; set Unavailable (no decision without evidence) | console error |
| Unexpected exception in manager | manager | Set Unavailable (fail closed), keep the loop alive | `service_unavailable` |
| Client sends malformed request | frontdoor | Standard 4xx from the HTTP layer; nothing logged about the request | none |
| Admin request with unknown replica | admin | 400 | none |

## 13. Logging and privacy design

| Aspect | Design |
|---|---|
| What is logged | Allow-listed audit fields only (section 7.3) |
| What is never logged | Client addresses, request paths and queries, headers, bodies, certificates, response bodies |
| Access logs | Disabled in aiohttp for the controller and for replicas |
| Console output | Same allow-listed events plus startup and fatal errors |
| Retention | Per-run directory under `results/`; delete after reporting |
| Integrity | Hash chain; `tools/verify_audit.py` verifies it |
| Basis | RFC 6973 data minimization: collect and keep only what the stated purpose needs |

The audit log has to keep `ts`, `event`, `replica` and `decision` to do its job. The extra fields (`reason`, `policy`, `run_id`, `seq`, `prev`, `hash`) are metadata needed to explain and verify decisions; none identifies a user.

## 14. Configuration and deployment

`docker-compose.yml` (outline; the full file is in the MVP Tech Doc):

- Services: `controller`, `replica-a`, `replica-b`, all on network `lab-net`.
- `replica-a` and `replica-b`: build from `replicas/Dockerfile`, `cap_add: [NET_ADMIN]`, mount `certs/` read-only, environment `REPLICA_ID`, `REPLICA_PROFILE`, publish `127.0.0.1:9443` and `127.0.0.1:9444` for direct load generation.
- `controller`: mounts `certs/`, `policy/`, `results/`; publishes `8443:8443` and `127.0.0.1:9000:9000`.
- Probe and runner run on the host (they need the Docker CLI and a shared clock).

## 15. Test strategy

### 15.1 Levels

| Level | Scope | Needs Docker |
|---|---|---|
| Unit | policy, audit, health state machine, downtime analyzer, config validation | No |
| Component | observer against local TLS servers with each profile; front door against a stub upstream | No |
| Integration | controller plus two real replicas; each scenario once | Yes |
| Scenario matrix | S1 to S9, 10 repeats each, results aggregated | Yes |

### 15.2 Test catalogue (selected)

| ID | Test | Expectation |
|---|---|---|
| TS-U-01 to 06 | One test per rule R1 to R6 (pass and fail) | Exact reason code |
| TS-U-07 | Multiple failing rules | Reasons in rule order, joined as documented |
| TS-U-08 | Determinism: same observation 1000 times | Identical decisions |
| TS-U-09 | Version comparison | `"1.10"` style mistakes cannot occur (numeric tuples) |
| TS-U-10 | Strict mode: negotiated 1.3 but legacy 1.1 accepted | FAIL in `no_legacy_support`, PASS in `negotiated` |
| TS-U-20 | Health state machine thresholds and recovery | Transitions at the defined counts |
| TS-U-21 | Passive failure triggers immediate check | Check scheduled |
| TS-U-30 | Audit chain verifies | OK |
| TS-U-31 | Forbidden field is dropped | Not present in the file |
| TS-U-32 | Edited line breaks verification | Verifier reports the line |
| TS-U-40 | Downtime on a synthetic log with one outage | Equals expected value |
| TS-U-41 | Open outage (never recovers) | `outage_open = true` |
| TS-U-42 | Two outages | Primary one is chosen after the fault timestamp |
| TS-C-01 | Observer vs each replica profile | Matches the expected observation |
| TS-C-02 | Data-path context vs TLS 1.1 replica | Refused |
| TS-I-01 | S1 once | Failover, order of events correct |
| TS-I-02 | S4 once | Refusal, zero requests served by B |
| TS-I-03 | Every route change is preceded by a PASS evaluation | True for all runs |
| TS-S-xx | Scenario matrix | Success criteria in PRD section 12 |

### 15.3 Safety properties checked on every run

- **SI-1**: no successful probe response has `served_by` equal to a replica whose latest evaluation was FAIL.
- **SI-2**: every `failover_done`, `service_restored` and manual switch is immediately preceded by `policy_evaluated PASS` for the same replica.
- **SI-3**: the audit chain verifies and `seq` is contiguous.

## 16. Performance considerations

- Probe load is 20 requests per second; health checks add about 20 requests per second across two replicas. This is trivial for one event loop.
- Upstream connections are kept alive and pooled per replica to keep the proxy overhead low (target: median overhead under 10 ms, to be measured).
- The observation (one handshake plus one GET) is only done at decision time and by the periodic tick while unavailable, not on every request.
- Throughput is not a goal; the measurements of interest are detection time and downtime.

## 17. Open design questions

1. Should the controller periodically re-evaluate the **active** replica as well, and fail closed if it stops being compliant? (Proposed stretch goal.)
2. Should `hold_and_retry` be part of the demo, or only reported as an experiment?
3. For `label_mismatch`, is it acceptable that the replica declares an allowed label while its certificate disagrees? (Our design says that must fail, through R4.)
4. Do we show the realistic overload variant live, or only the deterministic one?
5. Should the final report include a short sketch of controller high availability?
