# MVP Technical Document

**Project:** PS-006 Policy-Constrained Service Failover Demonstrator
**Team:** Algo-Ancesstors (`A3-PS006-TC329`), AIORI Hackathon 3
**Authors:** Ankur Pratap Singh, Dev Saraswat
**Version:** 0.1 (draft)   **Date:** 2026-10-20

Related documents: [PRD](PRD.md) · [Architecture](Architecture.md) · [System Design](System%20Design.md)

---

## 1. What this document is

A build plan for the MVP: what is in and out, the repository layout, milestones with exit criteria, and **reference code** for each module. The [System Design](System%20Design.md) explains why each piece looks the way it does; this document says how to build and run it.

**Status of the code in this document**

| Part | Status |
|---|---|
| `models`, `policy`, `audit`, `health`, `analyze`, `timeline`, `verify_audit`, `observer`, replica server, `check_once`, `gen_certs.sh` and their tests | **Executed**: 52 automated tests pass in a local harness (no Docker) |
| `manager`, `frontdoor`, `main`, `probe` | **Executed end to end locally** (controller, two replicas and probe as local processes, no Docker): crash of A with a compliant B, and with three non-compliant B profiles. The admin API is still a `TODO` in `main.py` |
| Injector scripts, `docker-compose.yml`, `Makefile`, `scenarios/runner.py` | **Syntax-checked or parsed only** (`bash -n`, `py_compile`, `docker compose config`, YAML load). Not yet run against real containers |
| Link loss (`tc netem`), realistic overload, Docker build and run, `hold_and_retry`, strict TLS mode in the controller | **Not yet run**; these are the work of milestones M0, M1, M4 and M5 |

Every fenced code block that starts with a `# file: <path>` line is meant to be saved at that path in the repository.

## 2. MVP definition

### 2.1 In the MVP

1. Two replicas (A, B) over TLS with selectable B profiles.
2. Lab CA and certificates with location SAN.
3. Controller: HTTPS reverse proxy, health monitor (active and passive), observer, policy engine (rules R1 to R6), failover manager, audit logger, minimal admin API.
4. Three failure injectors: crash, link loss, overload (deterministic variant required, realistic variant optional).
5. Probe at 50 ms, downtime analyzer, scenario runner, per-run result files.
6. Timeline viewer and audit verifier.
7. Scenarios S1 to S4 working end to end (the demo set); S5 to S9 as variations.
8. Report PDF and a one-page pseudocode snippet.

### 2.2 Not in the MVP (stretch)

Dashboard page, `hold_and_retry` mode, `no_legacy_support` strict mode, periodic re-evaluation of the active replica, Prometheus metrics, controller high availability.

### 2.3 Definition of done

- `make demo` runs S1, S2, S3 and S4 on a clean machine and prints, for each, the timeline and the downtime number.
- All unit tests pass (`make test`).
- For every run: `audit_chain_ok`, `audit_order_ok` and `served_by_noncompliant == 0`.
- Repository, PDF report and pseudocode snippet are delivered as listed in the PRD.

## 3. Prerequisites and setup

| Tool | Version | Check |
|---|---|---|
| Linux host or VM | any recent | `uname -a` |
| Docker Engine and Compose v2 | recent | `docker compose version` |
| OpenSSL CLI | 1.1.1 or 3.x | `openssl version` |
| Python | 3.12 or newer | `python3 --version` |
| `hey` (optional load generator) | any | `hey -h` |
| GNU `date` with `%N` support | coreutils | `date +%s%N` |

First-time setup:

```bash
git clone <your-private-repo> Algo-Ancesstors && cd Algo-Ancesstors
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
make certs        # creates certs/ (never committed)
make test         # unit tests, no Docker needed
make up           # builds and starts controller + replicas
```

Pin exact dependency versions in M0 with `pip freeze` so that results are reproducible.

## 4. Repository layout

The repository is named after the team (`Algo-Ancesstors`), as the brief requires.

```
Algo-Ancesstors/
├── README.md
├── Makefile
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
├── requirements-dev.txt
├── .gitignore                  # certs/*.key, certs/ca.*, results/, .venv/
├── config/
│   └── controller.yaml
├── policy/
│   └── policy.yaml
├── certs/
│   └── gen_certs.sh
├── controller/
│   ├── app/                    # models, policy, audit, health, observer, monitor, manager, frontdoor, main
│   └── tests/
├── replicas/
│   └── replica_app/server.py
├── injector/                   # lib.sh, crash.sh, linkloss.sh, overload.sh
├── probe/                      # probe.py, analyze.py
├── scenarios/                  # scenarios.yaml, runner.py
├── tools/                      # timeline.py, verify_audit.py
├── results/                    # per-run output (ignored by Git)
└── docs/                       # PRD, Architecture, System Design, MVP Tech Doc, report PDF, pseudocode.md
```

Create two empty files so both directories import as Python packages: `controller/app/__init__.py` and `replicas/replica_app/__init__.py`. The controller package is `app` and the replica package is `replica_app`, so both can be on one `sys.path` (see `pytest.ini`).

## 5. Milestones and tasks

Time estimates assume two people working in parallel and are planning guesses, not commitments.

| Milestone | Tasks | Exit criteria | Estimate |
|---|---|---|---|
| **M0 Spikes** | (1) TLS 1.1 handshake in Python: **done** on 2026-10-20, see System Design 2.2. (2) Repeat inside the Docker image you will use. (3) `tc netem` works in the replica container with `NET_ADMIN`. (4) `docker kill` and `docker network disconnect` behaviour: record the reason codes seen by a client | Short written result for each spike; decision on TLS minimum (1.2 or the 1.3 fallback) | 0.5 day |
| **M1 Replicas and PKI** | `gen_certs.sh`; replica server with profiles; Dockerfile; compose with two replicas | `make up`; `curl --cacert certs/ca.crt https://localhost:9443/meta` returns the label; B profile switch works | 0.5 day |
| **M2 Policy, audit, health (pure code)** | Save and run the modules and tests in section 6 | `make test` green | 0.5 day |
| **M3 Controller core** | Observer, monitor, manager, front door, main, admin API | S1 works end to end by hand: kill A, B takes over, timeline printed | 1 day |
| **M4 Injectors, probe, analyzer** | Three injectors, probe, downtime analysis | S1 to S3 each produce a downtime number | 0.5 to 1 day |
| **M5 Scenario runner** | Runner with repeats, results files, matrix CSV | `make matrix` produces `results/matrix.csv` | 0.5 day |
| **M6 Polish** | Timeline viewer, verifier, admin endpoints, README, demo rehearsal | Demo script runs in under 5 minutes | 0.5 day |
| **M7 Report and handover** | PDF in the required structure, pseudocode snippet, repository transfer steps | Deliverables checklist in the PRD complete | 0.5 day |

If time is short: finish **S1 end to end first**, then add S2 and S3 as variations (this is the advice in the team's approach document).

## 6. Reference implementation

### 6.1 Requirements

```text
# file: requirements.txt
aiohttp>=3.9,<4
PyYAML>=6.0
```

```text
# file: requirements-dev.txt
-r requirements.txt
pytest>=8.0
pytest-asyncio>=0.23
```

### 6.2 PKI script

Generates the lab CA, the controller certificate, and certificates for both replicas with both labels (`replica-a-in`, `replica-a-eu`, `replica-b-in`, `replica-b-eu`). The profile decides which one a replica uses.

```bash
# file: certs/gen_certs.sh
#!/usr/bin/env bash
# Generates the lab CA and leaf certificates into the directory given as $1 (default: this script's directory).
set -euo pipefail
OUT="${1:-$(cd "$(dirname "$0")" && pwd)}"
mkdir -p "$OUT"
cd "$OUT"

DAYS=10
# Strict TLS clients (Python 3.13+ default context) require the CA to carry keyUsage and basicConstraints.
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days "$DAYS" \
  -subj "/CN=Algo-Ancesstors Lab CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash" 2>/dev/null

issue() {  # issue <file-stem> <common-name> <subjectAltName>
  local stem="$1" cn="$2" san="$3"
  openssl req -newkey rsa:2048 -nodes -keyout "$stem.key" -out "$stem.csr" -subj "/CN=$cn" 2>/dev/null
  printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n' "$san" > "$stem.ext"
  openssl x509 -req -in "$stem.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out "$stem.crt" -days "$DAYS" -extfile "$stem.ext" 2>/dev/null
  rm -f "$stem.csr" "$stem.ext"
}

issue controller   controller "DNS:controller,DNS:localhost"
for r in a b; do
  for loc in in eu; do
    LOC="$(echo "$loc" | tr '[:lower:]' '[:upper:]')"
    issue "replica-$r-$loc" "replica-$r" "DNS:replica-$r,DNS:localhost,URI:urn:aiori-lab:location:$LOC"
  done
done
chmod 600 ./*.key
echo "certificates written to $OUT"
```

(`DNS:localhost` is included in replica certificates so that load generators and the host-side checks can use the published ports.)

### 6.3 Models

```python
# file: controller/app/models.py
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Health(str, Enum):
    UNKNOWN = "UNKNOWN"
    HEALTHY = "HEALTHY"
    UNHEALTHY = "UNHEALTHY"


class Mode(str, Enum):
    STARTING = "STARTING"
    SERVING = "SERVING"
    EVALUATING = "EVALUATING"
    UNAVAILABLE = "UNAVAILABLE"


@dataclass(frozen=True)
class RouteTable:
    """Immutable; replaced atomically. The front door reads it without locks."""
    mode: Mode
    active: str | None
    epoch: int


@dataclass(frozen=True)
class Observation:
    replica_id: str
    reachable: bool
    cert_trusted: bool = False
    tls_version: str | None = None           # "1.0" | "1.1" | "1.2" | "1.3"
    declared_location: str | None = None     # from /meta
    cert_location: str | None = None         # from the certificate SAN URI
    declared_logging: str | None = None      # from /meta
    legacy_accepted: tuple[str, ...] | None = None


@dataclass(frozen=True)
class Decision:
    replica_id: str
    passed: bool
    reasons: tuple[str, ...]
    policy_id: str
    policy_sha: str

    @property
    def reason_text(self) -> str:
        return "+".join(self.reasons) if self.reasons else "-"
```

### 6.4 Policy engine

```python
# file: controller/app/policy.py
"""Policy model, loader and the pure evaluate() function. No I/O inside evaluate()."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

import yaml

from .models import Decision, Observation

VERSIONS = {"1.0": (1, 0), "1.1": (1, 1), "1.2": (1, 2), "1.3": (1, 3)}
ENFORCEMENT = ("negotiated", "no_legacy_support")


class PolicyError(ValueError):
    pass


@dataclass(frozen=True)
class Policy:
    policy_id: str
    allowed_locations: tuple[str, ...]
    require_cert_label_match: bool
    tls_min_version: str
    tls_enforcement: str
    require_replica_minimal_logging: bool
    sha: str  # first 12 hex characters of the SHA-256 of the policy text


def _only_keys(mapping: dict, allowed: tuple[str, ...], where: str) -> None:
    extra = set(mapping) - set(allowed)
    if extra:
        raise PolicyError(f"unknown key(s) in {where}: {sorted(extra)}")


def _section(raw: dict, name: str, allowed: tuple[str, ...]) -> dict:
    section = raw.get(name) or {}
    if not isinstance(section, dict):
        raise PolicyError(f"'{name}' must be a mapping")
    _only_keys(section, allowed, name)
    return section


def _flag(section: dict, key: str, default: bool, where: str) -> bool:
    value = section.get(key, default)
    if not isinstance(value, bool):
        raise PolicyError(f"{where}.{key} must be true or false")
    return value


def parse_policy(text: str) -> Policy:
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise PolicyError(f"invalid YAML: {exc}") from exc
    if not isinstance(raw, dict):
        raise PolicyError("policy must be a mapping")
    _only_keys(raw, ("version", "policy_id", "allowed_locations", "location", "tls", "logging"), "policy")
    if raw.get("version") != 1:
        raise PolicyError("version must be 1")
    policy_id = raw.get("policy_id")
    if not isinstance(policy_id, str) or not policy_id:
        raise PolicyError("policy_id must be a non-empty string")
    locations = raw.get("allowed_locations")
    if not isinstance(locations, list) or not locations or not all(isinstance(x, str) and x for x in locations):
        raise PolicyError("allowed_locations must be a non-empty list of strings")

    location = _section(raw, "location", ("require_cert_label_match",))
    tls = _section(raw, "tls", ("min_version", "enforcement", "require_trusted_cert"))
    logging = _section(raw, "logging", ("mode", "require_replica_minimal_logging"))

    min_version = str(tls.get("min_version", "1.2"))
    if min_version not in VERSIONS:
        raise PolicyError(f"tls.min_version must be one of {sorted(VERSIONS)}")
    enforcement = tls.get("enforcement", "negotiated")
    if enforcement not in ENFORCEMENT:
        raise PolicyError(f"tls.enforcement must be one of {list(ENFORCEMENT)}")
    if tls.get("require_trusted_cert", True) is not True:
        raise PolicyError("tls.require_trusted_cert must be true in the MVP")
    if logging.get("mode", "minimal") != "minimal":
        raise PolicyError("logging.mode must be 'minimal'")

    return Policy(
        policy_id=policy_id,
        allowed_locations=tuple(locations),
        require_cert_label_match=_flag(location, "require_cert_label_match", True, "location"),
        tls_min_version=min_version,
        tls_enforcement=enforcement,
        require_replica_minimal_logging=_flag(logging, "require_replica_minimal_logging", True, "logging"),
        sha=sha,
    )


def load_policy(path: str) -> Policy:
    with open(path, encoding="utf-8") as handle:
        return parse_policy(handle.read())


def evaluate(policy: Policy, obs: Observation) -> Decision:
    """Pure and deterministic: same (policy, obs) always gives the same Decision."""

    def result(reasons: list[str]) -> Decision:
        return Decision(obs.replica_id, not reasons, tuple(reasons), policy.policy_id, policy.sha)

    if not obs.reachable:
        return result(["R1_UNREACHABLE"])
    if not obs.cert_trusted:  # evidence from an untrusted peer is not evidence
        return result(["R2_CERT_UNTRUSTED"])

    reasons: list[str] = []
    if obs.declared_location not in policy.allowed_locations:
        reasons.append("R3_LOCATION_NOT_ALLOWED")
    if policy.require_cert_label_match and (
        obs.cert_location is None or obs.declared_location != obs.cert_location
    ):
        reasons.append("R4_LABEL_CERT_MISMATCH")

    have = VERSIONS.get(obs.tls_version) if obs.tls_version else None
    need = VERSIONS[policy.tls_min_version]
    if have is None or have < need:
        reasons.append("R5_TLS_BELOW_MIN")
    elif policy.tls_enforcement == "no_legacy_support" and obs.legacy_accepted:
        reasons.append("R5_TLS_BELOW_MIN")

    if policy.require_replica_minimal_logging and obs.declared_logging != "minimal":
        reasons.append("R6_LOGGING_NOT_MINIMAL")
    return result(reasons)
```

```yaml
# file: policy/policy.yaml
version: 1
policy_id: lab-policy-001
allowed_locations: [IN]
location:
  require_cert_label_match: true
tls:
  min_version: "1.2"
  enforcement: negotiated
  require_trusted_cert: true
logging:
  mode: minimal
  require_replica_minimal_logging: true
```

### 6.5 Audit logger and verifier

`emit()` is synchronous and has no `await`, so it is atomic with respect to the event loop. Unknown keyword arguments are accepted and **dropped**; that is the allow-list. Free text is impossible: `reason` must be made of enumerated-looking codes.

```python
# file: controller/app/audit.py
"""Allow-listed, hash-chained JSON Lines audit log."""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Callable

GENESIS = "0" * 64
FIELDS = ("seq", "ts", "run_id", "event", "replica", "decision", "reason", "policy")
CHAIN_FIELDS = ("prev", "hash")

EVENTS = frozenset({
    "controller_started", "policy_loaded", "policy_load_failed", "health_changed",
    "failure_detected", "policy_evaluated", "failover_done", "failover_refused",
    "service_unavailable", "service_restored", "admin_switch_requested",
    "fault_injected", "fault_cleared",
})
DECISIONS = frozenset({"HEALTHY", "UNHEALTHY", "PASS", "FAIL", "SWITCHED", "REFUSED", "UP", "DOWN", "-"})
REPLICAS = frozenset({"A", "B", "-"})
_REASON = re.compile(r"^(-|[A-Z0-9_]+(\+[A-Z0-9_]+)*)$")
_POLICY = re.compile(r"^(-|[0-9a-f]{12})$")


def canonical(obj: dict) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def chain_hash(prev: str, body: dict) -> str:
    return hashlib.sha256((prev + canonical(body)).encode("utf-8")).hexdigest()


class AuditLog:
    def __init__(self, path: str, run_id: str, clock: Callable[[], datetime] | None = None) -> None:
        self._run_id = run_id
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self._fh = open(path, "w", encoding="utf-8")
        self._seq = 0
        self._prev = GENESIS

    def emit(self, event: str, replica: str = "-", decision: str = "-",
             reason: str = "-", policy: str = "-", **_dropped: object) -> dict:
        if event not in EVENTS:
            raise ValueError(f"unknown event: {event}")
        if replica not in REPLICAS or decision not in DECISIONS:
            raise ValueError("replica or decision not in the allowed set")
        if not _REASON.match(reason) or len(reason) > 120:
            raise ValueError("reason must be enumerated codes joined by '+'")
        if not _POLICY.match(policy):
            raise ValueError("policy must be '-' or 12 hex characters")
        self._seq += 1
        body = {
            "seq": self._seq,
            "ts": self._clock().strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
            "run_id": self._run_id,
            "event": event,
            "replica": replica,
            "decision": decision,
            "reason": reason,
            "policy": policy,
        }
        digest = chain_hash(self._prev, body)
        record = {**body, "prev": self._prev, "hash": digest}
        self._fh.write(json.dumps(record, separators=(",", ":")) + "\n")
        self._fh.flush()
        self._prev = digest
        return record

    def close(self) -> None:
        self._fh.close()


def verify_chain(path: str) -> tuple[bool, int | None, str]:
    """Return (ok, line_number_of_first_problem, message)."""
    prev, expected = GENESIS, 1
    with open(path, encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                return False, number, "not valid JSON"
            if set(record) != set(FIELDS) | set(CHAIN_FIELDS):
                return False, number, "unexpected or missing fields"
            if record["seq"] != expected:
                return False, number, "sequence gap"
            if record["prev"] != prev:
                return False, number, "broken link"
            body = {key: record[key] for key in FIELDS}
            if chain_hash(prev, body) != record["hash"]:
                return False, number, "hash mismatch"
            prev, expected = record["hash"], expected + 1
    return True, None, "ok"
```

### 6.6 Health state machine

```python
# file: controller/app/health.py
from __future__ import annotations

from .models import Health


class HealthTracker:
    """Pure state machine. Returns the new state only when it changes."""

    def __init__(self, failure_threshold: int = 2, recovery_threshold: int = 3) -> None:
        self.failure_threshold = failure_threshold
        self.recovery_threshold = recovery_threshold
        self.state = Health.UNKNOWN
        self.consecutive_fail = 0
        self.consecutive_ok = 0
        self.last_reason = "-"

    def _apply(self) -> Health | None:
        old = self.state
        if self.state in (Health.UNKNOWN, Health.HEALTHY) and self.consecutive_fail >= self.failure_threshold:
            self.state = Health.UNHEALTHY
        elif self.state == Health.UNKNOWN and self.consecutive_ok >= 1:
            self.state = Health.HEALTHY
        elif self.state == Health.UNHEALTHY and self.consecutive_ok >= self.recovery_threshold:
            self.state = Health.HEALTHY
        return self.state if self.state != old else None

    def on_result(self, ok: bool, reason: str = "-") -> Health | None:
        if ok:
            self.consecutive_ok += 1
            self.consecutive_fail = 0
        else:
            self.consecutive_fail += 1
            self.consecutive_ok = 0
            self.last_reason = reason
        return self._apply()

    def on_passive_failure(self, reason: str) -> Health | None:
        """A failed proxied request counts as one failure signal."""
        return self.on_result(False, reason)
```

### 6.7 Downtime analyzer

```python
# file: probe/analyze.py
"""Downtime computation from probe records (see System Design 5.6)."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Outage:
    start_ns: int
    end_ns: int
    downtime_ms: float
    open: bool            # True if the service never recovered during the run
    failed_requests: int


def load_probe(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def find_outages(records: list[dict]) -> list[Outage]:
    recs = sorted(records, key=lambda r: r["t_send_ns"])
    outages: list[Outage] = []
    i, n = 0, len(recs)
    while i < n:
        if recs[i]["ok"]:
            i += 1
            continue
        j = i
        while j < n and not recs[j]["ok"]:
            j += 1
        start = recs[i]["t_send_ns"]
        if j < n:
            end, is_open = recs[j]["t_send_ns"], False
        else:
            end, is_open = recs[-1]["t_send_ns"], True
        outages.append(Outage(start, end, (end - start) / 1e6, is_open, j - i))
        i = j
    return outages


def primary_outage(outages: list[Outage], fault_ns: int, interval_ms: float = 50.0) -> Outage | None:
    """First outage that starts no earlier than one probe interval before the fault."""
    threshold = fault_ns - int(interval_ms * 1e6)
    for outage in outages:
        if outage.start_ns >= threshold:
            return outage
    return None


def percentile(values: list[float], p: float) -> float:
    """Nearest-rank percentile."""
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100 * len(ordered)))
    return ordered[rank - 1]


def summarize(values: list[float]) -> dict:
    if not values:
        return {"count": 0, "mean": None, "p50": None, "p95": None, "min": None, "max": None}
    return {
        "count": len(values),
        "mean": sum(values) / len(values),
        "p50": percentile(values, 50),
        "p95": percentile(values, 95),
        "min": min(values),
        "max": max(values),
    }
```

### 6.8 Tests for the pure modules

```python
# file: controller/tests/test_policy.py
import pytest

from app.models import Observation
from app.policy import PolicyError, evaluate, parse_policy

POLICY = """
version: 1
policy_id: lab-policy-001
allowed_locations: [IN]
location: {require_cert_label_match: true}
tls: {min_version: "1.2", enforcement: negotiated, require_trusted_cert: true}
logging: {mode: minimal, require_replica_minimal_logging: true}
"""


def good(**overrides):
    base = dict(replica_id="B", reachable=True, cert_trusted=True, tls_version="1.3",
                declared_location="IN", cert_location="IN", declared_logging="minimal",
                legacy_accepted=None)
    base.update(overrides)
    return Observation(**base)


def test_pass():
    d = evaluate(parse_policy(POLICY), good())
    assert d.passed and d.reasons == ()


@pytest.mark.parametrize("override,code", [
    (dict(reachable=False), "R1_UNREACHABLE"),
    (dict(cert_trusted=False), "R2_CERT_UNTRUSTED"),
    (dict(declared_location="EU", cert_location="EU"), "R3_LOCATION_NOT_ALLOWED"),
    (dict(cert_location="EU"), "R4_LABEL_CERT_MISMATCH"),
    (dict(cert_location=None), "R4_LABEL_CERT_MISMATCH"),
    (dict(tls_version="1.1"), "R5_TLS_BELOW_MIN"),
    (dict(tls_version=None), "R5_TLS_BELOW_MIN"),
    (dict(declared_logging="verbose"), "R6_LOGGING_NOT_MINIMAL"),
])
def test_each_rule_fails_with_its_code(override, code):
    d = evaluate(parse_policy(POLICY), good(**override))
    assert not d.passed and d.reasons == (code,)


def test_multiple_reasons_in_rule_order():
    d = evaluate(parse_policy(POLICY), good(declared_location="EU", cert_location="EU", tls_version="1.1"))
    assert d.reasons == ("R3_LOCATION_NOT_ALLOWED", "R5_TLS_BELOW_MIN")


def test_unreachable_hides_other_rules():
    d = evaluate(parse_policy(POLICY), good(reachable=False, tls_version="1.0", declared_location="EU"))
    assert d.reasons == ("R1_UNREACHABLE",)


def test_tls_12_is_not_below_min_and_comparison_is_numeric():
    p = parse_policy(POLICY)
    assert evaluate(p, good(tls_version="1.2")).passed
    assert not evaluate(p, good(tls_version="1.0")).passed


def test_strict_mode_catches_legacy_support():
    strict = parse_policy(POLICY.replace("negotiated", "no_legacy_support"))
    lax = parse_policy(POLICY)
    obs = good(tls_version="1.3", legacy_accepted=("1.1",))
    assert not evaluate(strict, obs).passed
    assert evaluate(lax, obs).passed


def test_determinism():
    p, o = parse_policy(POLICY), good(tls_version="1.1", declared_logging="verbose")
    first = evaluate(p, o)
    assert all(evaluate(p, o) == first for _ in range(1000))


@pytest.mark.parametrize("bad", [
    "just a string",
    "version: 2\npolicy_id: x\nallowed_locations: [IN]",
    "version: 1\npolicy_id: x\nallowed_locations: []",
    POLICY + "\nsurprise: 1",
    POLICY.replace("min_version: \"1.2\"", "min_version: \"9.9\""),
    POLICY.replace("require_trusted_cert: true", "require_trusted_cert: false"),
])
def test_invalid_policies_are_rejected(bad):
    with pytest.raises(PolicyError):
        parse_policy(bad)


def test_policy_hash_changes_with_content():
    assert parse_policy(POLICY).sha != parse_policy(POLICY + "\n# change").sha
```

```python
# file: controller/tests/test_audit.py
import json

import pytest

from app.audit import AuditLog, verify_chain


def make(tmp_path):
    return AuditLog(str(tmp_path / "audit.jsonl"), "T1")


def test_chain_verifies(tmp_path):
    log = make(tmp_path)
    log.emit("controller_started")
    log.emit("failure_detected", replica="A", decision="UNHEALTHY", reason="CONNECT_ERROR")
    log.emit("policy_evaluated", replica="B", decision="FAIL",
             reason="R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN", policy="9f2c1a7be340")
    log.close()
    assert verify_chain(str(tmp_path / "audit.jsonl")) == (True, None, "ok")


def test_forbidden_fields_are_dropped(tmp_path):
    log = make(tmp_path)
    record = log.emit("controller_started", client_ip="10.0.0.9", path="/secret", headers={"a": "b"})
    log.close()
    assert set(record) == {"seq", "ts", "run_id", "event", "replica", "decision",
                           "reason", "policy", "prev", "hash"}
    text = (tmp_path / "audit.jsonl").read_text()
    assert "10.0.0.9" not in text and "/secret" not in text


@pytest.mark.parametrize("kwargs", [
    dict(event="made_up"),
    dict(event="failure_detected", reason="free text with spaces"),
    dict(event="failure_detected", replica="C"),
    dict(event="failure_detected", decision="MAYBE"),
    dict(event="policy_loaded", policy="nothex"),
])
def test_invalid_values_are_rejected(tmp_path, kwargs):
    log = make(tmp_path)
    with pytest.raises(ValueError):
        log.emit(**kwargs)


def test_tampering_is_detected(tmp_path):
    log = make(tmp_path)
    for _ in range(4):
        log.emit("health_changed", replica="A", decision="HEALTHY")
    log.close()
    path = tmp_path / "audit.jsonl"
    lines = path.read_text().splitlines()
    record = json.loads(lines[2])
    record["decision"] = "UNHEALTHY"
    lines[2] = json.dumps(record, separators=(",", ":"))
    path.write_text("\n".join(lines) + "\n")
    ok, line, message = verify_chain(str(path))
    assert not ok and line == 3 and message == "hash mismatch"


def test_deleted_line_is_detected(tmp_path):
    log = make(tmp_path)
    for _ in range(4):
        log.emit("health_changed", replica="A", decision="HEALTHY")
    log.close()
    path = tmp_path / "audit.jsonl"
    lines = path.read_text().splitlines()
    del lines[1]
    path.write_text("\n".join(lines) + "\n")
    ok, line, message = verify_chain(str(path))
    assert not ok and line == 2 and message == "sequence gap"
```

```python
# file: controller/tests/test_health.py
from app.health import HealthTracker
from app.models import Health


def test_first_success_makes_healthy():
    t = HealthTracker()
    assert t.on_result(True) == Health.HEALTHY


def test_two_failures_make_unhealthy_one_does_not():
    t = HealthTracker(failure_threshold=2)
    t.on_result(True)
    assert t.on_result(False, "CONNECT_ERROR") is None
    assert t.on_result(False, "CONNECT_ERROR") == Health.UNHEALTHY
    assert t.last_reason == "CONNECT_ERROR"


def test_success_resets_failure_count():
    t = HealthTracker(failure_threshold=2)
    t.on_result(True)
    t.on_result(False, "READ_TIMEOUT")
    t.on_result(True)
    assert t.on_result(False, "READ_TIMEOUT") is None
    assert t.state == Health.HEALTHY


def test_recovery_needs_three_successes():
    t = HealthTracker(failure_threshold=2, recovery_threshold=3)
    t.on_result(True)
    t.on_result(False, "x")
    t.on_result(False, "x")
    assert t.state == Health.UNHEALTHY
    assert t.on_result(True) is None
    assert t.on_result(True) is None
    assert t.on_result(True) == Health.HEALTHY


def test_passive_failure_counts():
    t = HealthTracker(failure_threshold=2)
    t.on_result(True)
    assert t.on_passive_failure("CONNECT_ERROR") is None
    assert t.on_result(False, "CONNECT_ERROR") == Health.UNHEALTHY


def test_unknown_goes_unhealthy_after_threshold():
    t = HealthTracker(failure_threshold=2)
    t.on_result(False, "CONNECT_REFUSED")
    assert t.on_result(False, "CONNECT_REFUSED") == Health.UNHEALTHY
```

```python
# file: probe/tests/test_analyze.py
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analyze import find_outages, primary_outage, summarize  # noqa: E402

MS = 1_000_000


def rec(seq, ok, t0=1_000_000_000_000):
    return {"seq": seq, "t_send_ns": t0 + seq * 50 * MS, "ok": ok}


def test_single_outage_downtime():
    # ok for 0..9, fail 10..15, ok from 16 -> downtime = 6 intervals = 300 ms
    records = [rec(i, i < 10 or i >= 16) for i in range(30)]
    outages = find_outages(records)
    assert len(outages) == 1
    o = outages[0]
    assert o.downtime_ms == 300.0 and o.failed_requests == 6 and not o.open


def test_open_outage_when_service_never_recovers():
    records = [rec(i, i < 10) for i in range(30)]
    o = find_outages(records)[0]
    assert o.open and o.failed_requests == 20
    assert o.downtime_ms == (29 - 10) * 50


def test_no_outage():
    assert find_outages([rec(i, True) for i in range(10)]) == []


def test_two_outages_primary_is_the_one_after_the_fault():
    flags = [True] * 5 + [False] * 2 + [True] * 10 + [False] * 4 + [True] * 5
    records = [rec(i, ok) for i, ok in enumerate(flags)]
    outages = find_outages(records)
    assert len(outages) == 2
    fault_ns = records[17]["t_send_ns"]
    assert primary_outage(outages, fault_ns) is outages[1]


def test_unsorted_input_is_handled():
    records = [rec(i, i < 3 or i >= 6) for i in range(10)]
    records.reverse()
    assert find_outages(records)[0].downtime_ms == 150.0


def test_summary_statistics():
    s = summarize([100.0, 200.0, 300.0, 400.0, 500.0])
    assert s["count"] == 5 and s["mean"] == 300.0 and s["p50"] == 300.0
    assert s["p95"] == 500.0 and s["min"] == 100.0 and s["max"] == 500.0
    assert summarize([])["count"] == 0
```

```ini
# file: pytest.ini
[pytest]
asyncio_mode = auto
pythonpath = controller replicas
testpaths = controller/tests probe/tests replicas/tests
filterwarnings =
    ignore::DeprecationWarning
```

### 6.9 Replica server

One TLS context is built from the profile; `aiohttp` serves HTTPS with it.

```python
# file: replicas/replica_app/server.py
"""Lab replica: /health, /data, /meta over TLS. TLS limits and labels come from a profile."""
from __future__ import annotations

import asyncio
import os
import ssl
import warnings

from aiohttp import web

warnings.filterwarnings("ignore", category=DeprecationWarning)

TLS = {
    "1.0": ssl.TLSVersion.TLSv1,
    "1.1": ssl.TLSVersion.TLSv1_1,
    "1.2": ssl.TLSVersion.TLSv1_2,
    "1.3": ssl.TLSVersion.TLSv1_3,
}

PROFILES = {
    "compliant":       {"location": "IN", "cert": "in", "tls": ("1.2", "1.3"), "logging": "minimal"},
    "weak_tls":        {"location": "IN", "cert": "in", "tls": ("1.1", "1.1"), "logging": "minimal"},
    "eu_weak_tls":     {"location": "EU", "cert": "eu", "tls": ("1.1", "1.1"), "logging": "minimal"},
    "wrong_location":  {"location": "EU", "cert": "eu", "tls": ("1.2", "1.3"), "logging": "minimal"},
    "label_mismatch":  {"location": "IN", "cert": "eu", "tls": ("1.2", "1.3"), "logging": "minimal"},
    "verbose_logging": {"location": "IN", "cert": "in", "tls": ("1.2", "1.3"), "logging": "verbose"},
}


def build_ssl_context(profile_name: str, cert_file: str, key_file: str) -> ssl.SSLContext:
    profile = PROFILES[profile_name]
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_file, key_file)
    low, high = profile["tls"]
    if low in ("1.0", "1.1"):
        ctx.set_ciphers("ALL:@SECLEVEL=0")   # legacy versions need relaxed security level
    ctx.minimum_version = TLS[low]
    ctx.maximum_version = TLS[high]
    return ctx


def build_app(replica_id: str, profile_name: str, lab_token: str = "lab-only-token") -> web.Application:
    profile = PROFILES[profile_name]
    state = {"delay_ms": 0, "seq": 0}

    @web.middleware
    async def degrade(request: web.Request, handler):
        if state["delay_ms"] and not request.path.startswith("/lab/"):
            await asyncio.sleep(state["delay_ms"] / 1000)
        return await handler(request)

    async def health(_request):
        return web.json_response({"status": "ok", "replica": replica_id})

    async def data(_request):
        state["seq"] += 1
        return web.json_response({"replica": replica_id, "seq": state["seq"], "payload": "x" * 160},
                                 headers={"X-Replica": replica_id})

    async def meta(_request):
        return web.json_response({"replica": replica_id, "location": profile["location"],
                                  "logging": profile["logging"], "profile": profile_name})

    def authorized(request: web.Request) -> bool:
        return request.headers.get("X-Lab-Token") == lab_token

    async def lab_degrade(request):
        if not authorized(request):
            return web.json_response({"error": "forbidden"}, status=403)
        body = await request.json()
        state["delay_ms"] = max(0, int(body.get("delay_ms", 0)))
        return web.json_response({"delay_ms": state["delay_ms"]})

    async def lab_reset(request):
        if not authorized(request):
            return web.json_response({"error": "forbidden"}, status=403)
        state["delay_ms"] = 0
        return web.json_response({"delay_ms": 0})

    app = web.Application(middlewares=[degrade])
    app.add_routes([
        web.get("/health", health), web.get("/data", data), web.get("/meta", meta),
        web.post("/lab/degrade", lab_degrade), web.post("/lab/reset", lab_reset),
    ])
    return app


def main() -> None:
    replica_id = os.environ["REPLICA_ID"]
    profile_name = os.environ.get("REPLICA_PROFILE", "compliant")
    cert_dir = os.environ.get("CERT_DIR", "/certs")
    stem = f"{cert_dir}/replica-{replica_id.lower()}-{PROFILES[profile_name]['cert']}"
    ctx = build_ssl_context(profile_name, stem + ".crt", stem + ".key")
    app = build_app(replica_id, profile_name, os.environ.get("LAB_TOKEN", "lab-only-token"))
    web.run_app(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8443")),
                ssl_context=ctx, access_log=None, print=None)   # no access log (minimal logging)


if __name__ == "__main__":
    main()
```

### 6.10 Observer and single health check

```python
# file: controller/app/observer.py
"""Gathers facts about a candidate replica. Never decides; see policy.evaluate()."""
from __future__ import annotations

import asyncio
import json
import ssl
import warnings

from .models import Observation

warnings.filterwarnings("ignore", category=DeprecationWarning)

_TLS = {
    "1.0": ssl.TLSVersion.TLSv1,
    "1.1": ssl.TLSVersion.TLSv1_1,
    "1.2": ssl.TLSVersion.TLSv1_2,
    "1.3": ssl.TLSVersion.TLSv1_3,
}
_LOCATION_PREFIX = "urn:aiori-lab:location:"


def observer_context(ca_file: str, low: str = "1.0", high: str = "1.3") -> ssl.SSLContext:
    """Legacy-tolerant context so that weak servers can be *seen*. Never used for data traffic."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.load_verify_locations(ca_file)
    ctx.set_ciphers("ALL:@SECLEVEL=0")
    ctx.minimum_version = _TLS[low]
    ctx.maximum_version = _TLS[high]
    return ctx


def cert_location(peer_cert: dict | None) -> str | None:
    for kind, value in (peer_cert or {}).get("subjectAltName", ()):
        if kind == "URI" and value.startswith(_LOCATION_PREFIX):
            return value[len(_LOCATION_PREFIX):]
    return None


def _parse_http_json(raw: bytes) -> dict | None:
    head, _, body = raw.partition(b"\r\n\r\n")
    try:
        status = int(head.split(b" ", 2)[1])
        if status != 200:
            return None
        return json.loads(body)
    except (IndexError, ValueError):
        return None


async def _accepts_version(host: str, port: int, sni: str, ca_file: str, version: str, timeout: float) -> bool:
    ctx = observer_context(ca_file, version, version)
    try:
        _r, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port, ssl=ctx, server_hostname=sni), timeout)
    except (OSError, asyncio.TimeoutError, ssl.SSLError):
        return False
    writer.close()
    return True


async def observe(replica_id: str, host: str, port: int, sni: str, ca_file: str, *,
                  min_version: str = "1.2", check_legacy: bool = False,
                  timeout: float = 0.5) -> Observation:
    ctx = observer_context(ca_file)
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port, ssl=ctx, server_hostname=sni), timeout)
    except ssl.SSLCertVerificationError:
        return Observation(replica_id, reachable=True, cert_trusted=False)   # do not read data from it
    except (OSError, asyncio.TimeoutError, ssl.SSLError):
        return Observation(replica_id, reachable=False)

    try:
        ssl_object = writer.get_extra_info("ssl_object")
        version = (ssl_object.version() or "").replace("TLSv", "") or None
        label = cert_location(ssl_object.getpeercert())
        writer.write(f"GET /meta HTTP/1.1\r\nHost: {sni}\r\nConnection: close\r\n\r\n".encode())
        await writer.drain()
        raw = await asyncio.wait_for(reader.read(-1), timeout)
        meta = _parse_http_json(raw)
    except (OSError, asyncio.TimeoutError, ssl.SSLError):
        return Observation(replica_id, reachable=False)
    finally:
        writer.close()

    if meta is None:
        return Observation(replica_id, reachable=False)

    legacy = None
    if check_legacy:
        below = [v for v in ("1.0", "1.1", "1.2") if tuple(map(int, v.split("."))) < tuple(map(int, min_version.split(".")))]
        accepted = []
        for v in below:
            if await _accepts_version(host, port, sni, ca_file, v, timeout):
                accepted.append(v)
        legacy = tuple(accepted)

    return Observation(
        replica_id=replica_id, reachable=True, cert_trusted=True, tls_version=version,
        declared_location=meta.get("location"), cert_location=label,
        declared_logging=meta.get("logging"), legacy_accepted=legacy,
    )
```

```python
# file: controller/app/monitor.py
"""One health check, plus the periodic Monitor loop (skeleton)."""
from __future__ import annotations

import asyncio
import ssl
import time

import aiohttp

from .health import HealthTracker


def data_path_context(ca_file: str, min_version: ssl.TLSVersion = ssl.TLSVersion.TLSv1_2) -> ssl.SSLContext:
    """Strict context for health checks and proxied traffic."""
    ctx = ssl.create_default_context(cafile=ca_file)
    ctx.minimum_version = min_version
    return ctx


def classify(exc: BaseException) -> str:
    if isinstance(exc, aiohttp.ClientSSLError):
        return "TLS_ERROR"
    if isinstance(exc, asyncio.TimeoutError):
        return "CONNECT_TIMEOUT" if type(exc).__name__ == "ConnectionTimeoutError" else "READ_TIMEOUT"
    if isinstance(exc, aiohttp.ClientConnectorError):
        return "CONNECT_REFUSED" if isinstance(exc.os_error, ConnectionRefusedError) else "CONNECT_ERROR"
    return "CONNECT_ERROR"


async def check_once(session: aiohttp.ClientSession, base_url: str,
                     latency_threshold_ms: float = 1000.0) -> tuple[bool, str, float]:
    start = time.perf_counter()
    try:
        async with session.get(base_url + "/health") as response:
            await response.read()
            status = response.status
    except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
        return False, classify(exc), (time.perf_counter() - start) * 1000
    elapsed_ms = (time.perf_counter() - start) * 1000
    if status != 200:
        return False, "HTTP_STATUS", elapsed_ms
    if elapsed_ms > latency_threshold_ms:
        return False, "LATENCY_EXCEEDED", elapsed_ms
    return True, "-", elapsed_ms


class Monitor:
    """Skeleton: one loop per replica. Transitions are pushed to the manager's queue."""

    def __init__(self, replicas, session_factory, interval_s, latency_threshold_ms, events: asyncio.Queue,
                 failure_threshold: int = 2, recovery_threshold: int = 3) -> None:
        self.replicas = replicas                       # {"A": "https://replica-a:8443", ...}
        self.session_factory = session_factory
        self.interval_s = interval_s
        self.latency_threshold_ms = latency_threshold_ms
        self.events = events
        self.trackers = {rid: HealthTracker(failure_threshold, recovery_threshold) for rid in replicas}
        self._kick = {rid: asyncio.Event() for rid in replicas}

    def passive_failure(self, replica_id: str, reason: str) -> None:
        change = self.trackers[replica_id].on_passive_failure(reason)
        if change:
            self.events.put_nowait(("health", replica_id, change, reason))
        self._kick[replica_id].set()                   # run the next active check immediately

    async def run_replica(self, replica_id: str) -> None:
        session = self.session_factory()
        tracker = self.trackers[replica_id]
        while True:
            ok, reason, _ms = await check_once(session, self.replicas[replica_id], self.latency_threshold_ms)
            change = tracker.on_result(ok, reason)
            if change:
                self.events.put_nowait(("health", replica_id, change, tracker.last_reason))
            try:
                await asyncio.wait_for(self._kick[replica_id].wait(), self.interval_s)
            except asyncio.TimeoutError:
                pass
            self._kick[replica_id].clear()
```

### 6.11 Manager, front door, main (skeletons, not yet executed)

```python
# file: controller/app/manager.py
"""FailoverManager: the only place where the route changes. Skeleton following System Design 5.4."""
from __future__ import annotations

import asyncio

from .audit import AuditLog
from .models import Health, Mode, RouteTable
from .observer import observe
from .policy import Policy, evaluate


class FailoverManager:
    def __init__(self, replicas: dict, ca_file: str, policy: Policy, audit: AuditLog,
                 events: asyncio.Queue, initial_active: str = "A", decision_timeout_s: float = 0.5,
                 reevaluate_interval_s: float = 2.0) -> None:
        self.replicas = replicas            # {"A": {"host":..., "port":..., "sni":...}, ...}
        self.ca_file = ca_file
        self.policy = policy
        self.audit = audit
        self.events = events
        self.initial_active = initial_active
        self.decision_timeout_s = decision_timeout_s
        self.reevaluate_interval_s = reevaluate_interval_s
        self.route = RouteTable(Mode.STARTING, None, 0)
        self.health: dict[str, Health] = {rid: Health.UNKNOWN for rid in replicas}
        self.last_decision: dict[str, object] = {}

    # ----- policy gate -----------------------------------------------------------------
    async def gate(self, replica_id: str):
        r = self.replicas[replica_id]
        obs = await observe(replica_id, r["host"], r["port"], r["sni"], self.ca_file,
                            min_version=self.policy.tls_min_version,
                            check_legacy=self.policy.tls_enforcement == "no_legacy_support",
                            timeout=self.decision_timeout_s)
        decision = evaluate(self.policy, obs)
        self.last_decision[replica_id] = decision
        self.audit.emit("policy_evaluated", replica=replica_id,
                        decision="PASS" if decision.passed else "FAIL",
                        reason=decision.reason_text, policy=self.policy.sha)
        return decision

    def _set_route(self, mode: Mode, active: str | None, bump_epoch: bool = False) -> None:
        self.route = RouteTable(mode, active, self.route.epoch + (1 if bump_epoch else 0))

    def other(self, replica_id: str) -> str:
        return next(rid for rid in self.replicas if rid != replica_id)

    # ----- transitions -----------------------------------------------------------------
    async def start(self) -> None:
        for rid in (self.initial_active, self.other(self.initial_active)):
            if self.health[rid] != Health.UNHEALTHY and (await self.gate(rid)).passed:
                self._set_route(Mode.SERVING, rid)
                return
        self._set_route(Mode.UNAVAILABLE, None)
        self.audit.emit("service_unavailable", decision="DOWN", reason="NO_COMPLIANT_REPLICA")

    async def on_unhealthy(self, replica_id: str, reason: str) -> None:
        if self.route.mode != Mode.SERVING or self.route.active != replica_id:
            return
        self.audit.emit("failure_detected", replica=replica_id, decision="UNHEALTHY", reason=reason)
        self._set_route(Mode.EVALUATING, replica_id)
        candidate = self.other(replica_id)
        decision = await self.gate(candidate)
        if decision.passed and self.health[candidate] == Health.HEALTHY:
            self._set_route(Mode.SERVING, candidate, bump_epoch=True)
            self.audit.emit("failover_done", replica=candidate, decision="SWITCHED", policy=self.policy.sha)
        else:
            reasons = decision.reason_text if not decision.passed else "R1_UNREACHABLE"
            self.audit.emit("failover_refused", replica=candidate, decision="REFUSED", reason=reasons)
            self._set_route(Mode.UNAVAILABLE, None)
            self.audit.emit("service_unavailable", decision="DOWN", reason="NO_COMPLIANT_REPLICA")

    async def on_healthy(self, replica_id: str) -> None:
        if self.route.mode != Mode.UNAVAILABLE:
            return
        if (await self.gate(replica_id)).passed:
            self._set_route(Mode.SERVING, replica_id, bump_epoch=True)
            self.audit.emit("service_restored", replica=replica_id, decision="UP")

    async def run(self) -> None:
        """Single consumer: all transitions are serialized here."""
        await self.start()
        while True:
            try:
                kind, replica_id, state, reason = await asyncio.wait_for(
                    self.events.get(), self.reevaluate_interval_s)
            except asyncio.TimeoutError:
                for rid, h in self.health.items():
                    if h == Health.HEALTHY:
                        await self.on_healthy(rid)           # periodic retry while unavailable
                continue
            if kind != "health":
                continue
            self.health[replica_id] = state
            self.audit.emit("health_changed", replica=replica_id,
                            decision=state.value if state != Health.UNKNOWN else "-",
                            reason=reason if state == Health.UNHEALTHY else "-")
            if state == Health.UNHEALTHY:
                await self.on_unhealthy(replica_id, reason)
            elif state == Health.HEALTHY:
                await self.on_healthy(replica_id)
```

```python
# file: controller/app/frontdoor.py
"""HTTPS reverse proxy to the active replica. Skeleton following System Design 5.5."""
from __future__ import annotations

import aiohttp
from aiohttp import web

from .models import Mode
from .monitor import classify

HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
              "trailers", "transfer-encoding", "upgrade", "content-length", "host"}


def make_frontdoor(manager, monitor, sessions: dict[str, aiohttp.ClientSession], base_urls: dict[str, str]) -> web.Application:
    async def handle(request: web.Request) -> web.StreamResponse:
        route = manager.route                               # immutable snapshot
        if route.mode != Mode.SERVING:
            return web.json_response({"error": "no_compliant_replica", "epoch": route.epoch}, status=503)
        target = route.active
        try:
            headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP}
            async with sessions[target].request(request.method, base_urls[target] + request.rel_url.raw_path_qs,
                                                headers=headers, data=await request.read()) as upstream:
                body = await upstream.read()
                if upstream.status >= 500:
                    monitor.passive_failure(target, "HTTP_STATUS")
                response = web.Response(status=upstream.status, body=body)
                for k, v in upstream.headers.items():
                    if k.lower() not in HOP_BY_HOP:
                        response.headers[k] = v
        except (aiohttp.ClientError, TimeoutError) as exc:
            monitor.passive_failure(target, classify(exc))
            return web.json_response({"error": "upstream_failure"}, status=502)
        response.headers["X-Served-By"] = target
        response.headers["X-Failover-Epoch"] = str(route.epoch)
        return response

    app = web.Application()
    app.router.add_route("*", "/{tail:.*}", handle)
    return app
```

```python
# file: controller/app/main.py
"""Wiring (skeleton): config -> policy -> audit -> monitor -> manager -> front door + admin API."""
from __future__ import annotations

import argparse
import asyncio
import os
import ssl

import aiohttp
import yaml
from aiohttp import web

from .audit import AuditLog
from .frontdoor import make_frontdoor
from .manager import FailoverManager
from .monitor import Monitor, data_path_context
from .policy import load_policy


async def amain(config_path: str) -> None:
    cfg = yaml.safe_load(open(config_path, encoding="utf-8"))
    policy = load_policy(cfg["policy_file"])
    run_id = os.environ.get("RUN_ID", "run-0")
    audit = AuditLog(f"{cfg['audit']['dir']}/{run_id}/audit.jsonl", run_id)
    audit.emit("controller_started")
    audit.emit("policy_loaded", policy=policy.sha)

    ctx = data_path_context(cfg["tls"]["ca_file"])
    health = cfg["health"]
    timeout = aiohttp.ClientTimeout(sock_connect=health["connect_timeout_ms"] / 1000,
                                    total=health["read_timeout_ms"] / 1000)

    def new_session() -> aiohttp.ClientSession:
        return aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=ctx), timeout=timeout)

    base_urls = {r["id"]: r["url"] for r in cfg["replicas"]}
    replicas = {r["id"]: {"host": r["url"].split("//")[1].split(":")[0],
                          "port": int(r["url"].rsplit(":", 1)[1]), "sni": r["sni"]} for r in cfg["replicas"]}
    events: asyncio.Queue = asyncio.Queue()
    monitor = Monitor(base_urls, new_session, health["interval_ms"] / 1000, health["latency_threshold_ms"], events,
                      health["failure_threshold"], health["recovery_threshold"])
    manager = FailoverManager(replicas, cfg["tls"]["ca_file"], policy, audit, events, cfg["initial_active"],
                              cfg["failover"]["decision_timeout_ms"] / 1000,
                              cfg["failover"]["reevaluate_interval_ms"] / 1000)

    sessions = {rid: new_session() for rid in replicas}
    server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_ctx.load_cert_chain(cfg["listen"]["tls"]["cert"], cfg["listen"]["tls"]["key"])
    server_ctx.minimum_version = ssl.TLSVersion.TLSv1_2

    runner = web.AppRunner(make_frontdoor(manager, monitor, sessions, base_urls), access_log=None)
    await runner.setup()
    await web.TCPSite(runner, cfg["listen"]["host"], cfg["listen"]["port"], ssl_context=server_ctx).start()
    # TODO(M3/M6): admin API (state, timeline, reload, switch, reset) bound as in System Design 6.3

    tasks = [asyncio.create_task(monitor.run_replica(rid)) for rid in replicas]
    tasks.append(asyncio.create_task(manager.run()))
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/etc/lab/controller.yaml")
    asyncio.run(amain(parser.parse_args().config))
```

```yaml
# file: config/controller.yaml
listen:
  host: 0.0.0.0
  port: 8443
  tls: {cert: /certs/controller.crt, key: /certs/controller.key}
admin: {host: 0.0.0.0, port: 9000}     # published to 127.0.0.1 only in docker-compose.yml
replicas:
  - {id: A, url: "https://replica-a:8443", sni: replica-a}
  - {id: B, url: "https://replica-b:8443", sni: replica-b}
initial_active: A
tls: {ca_file: /certs/ca.crt, data_path_min_version: "1.2"}
health:
  interval_ms: 100
  connect_timeout_ms: 250
  read_timeout_ms: 1500
  latency_threshold_ms: 1000
  failure_threshold: 2
  recovery_threshold: 3
failover: {mode: strict, hold_ms: 1500, decision_timeout_ms: 500, reevaluate_interval_ms: 2000}
audit: {dir: /results}
policy_file: /policy/policy.yaml
```

### 6.12 Probe, timeline and audit verifier

```python
# file: probe/probe.py
"""Sends one request every 50 ms on a fixed schedule and logs each result as JSON Lines."""
from __future__ import annotations

import argparse
import asyncio
import json
import ssl
import time

import aiohttp


async def one(session, url, seq, send_ns, out, timeout_s):
    record = {"seq": seq, "t_send_ns": send_ns, "t_recv_ns": None, "status": None, "ok": False,
              "latency_ms": None, "served_by": None, "epoch": None, "error": None}
    started = time.perf_counter()
    try:
        async with session.get(url) as response:
            await response.read()
            record["status"] = response.status
            record["served_by"] = response.headers.get("X-Served-By")
            record["epoch"] = int(response.headers["X-Failover-Epoch"]) if "X-Failover-Epoch" in response.headers else None
            record["ok"] = response.status == 200 and record["served_by"] is not None
            record["error"] = None if record["ok"] else "http_status"
    except asyncio.TimeoutError:
        record["error"] = "timeout"
    except aiohttp.ClientSSLError:
        record["error"] = "tls_error"
    except aiohttp.ClientError:
        record["error"] = "conn_error"
    record["latency_ms"] = round((time.perf_counter() - started) * 1000, 3)
    record["t_recv_ns"] = send_ns + int(record["latency_ms"] * 1e6)
    out.write(json.dumps(record, separators=(",", ":")) + "\n")


async def run(url: str, ca: str, out_path: str, interval_ms: float, duration_s: float, timeout_ms: float) -> None:
    ctx = ssl.create_default_context(cafile=ca)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    timeout = aiohttp.ClientTimeout(total=timeout_ms / 1000)
    start_perf = time.perf_counter()
    base_wall, base_perf = time.time_ns(), time.perf_counter_ns()
    pending: set[asyncio.Task] = set()
    with open(out_path, "w", encoding="utf-8") as out:
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=ctx, limit=0), timeout=timeout) as session:
            seq = 0
            while True:
                target = start_perf + seq * interval_ms / 1000       # absolute schedule: no drift
                if target - start_perf >= duration_s:
                    break
                delay = target - time.perf_counter()
                if delay > 0:
                    await asyncio.sleep(delay)
                send_ns = base_wall + (time.perf_counter_ns() - base_perf)
                task = asyncio.create_task(one(session, url, seq, send_ns, out, timeout_ms / 1000))
                pending.add(task)
                task.add_done_callback(pending.discard)
                seq += 1
            await asyncio.gather(*pending)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="https://localhost:8443/data")
    parser.add_argument("--ca", default="certs/ca.crt")
    parser.add_argument("--out", required=True)
    parser.add_argument("--interval-ms", type=float, default=50)
    parser.add_argument("--duration-s", type=float, default=15)
    parser.add_argument("--timeout-ms", type=float, default=500)
    a = parser.parse_args()
    asyncio.run(run(a.url, a.ca, a.out, a.interval_ms, a.duration_s, a.timeout_ms))
```

```python
# file: tools/timeline.py
"""Merge audit.jsonl and injector.jsonl of one run and print a readable timeline.
Usage: python tools/timeline.py results/<run_id>"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime


def parse_ts(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%S.%fZ")


def load(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def build_lines(run_dir: str) -> list[str]:
    events = load(os.path.join(run_dir, "audit.jsonl")) + load(os.path.join(run_dir, "injector.jsonl"))
    events.sort(key=lambda e: parse_ts(e["ts"]))
    if not events:
        return ["(no events)"]
    faults = [e for e in events if e["event"] == "fault_injected"]
    t0 = parse_ts((faults[0] if faults else events[0])["ts"])
    lines = [f"{'time':>9}  {'event':<24} {'replica':<7} {'decision':<9} reason"]
    for e in events:
        dt = (parse_ts(e["ts"]) - t0).total_seconds()
        lines.append(f"{dt:+8.3f}s  {e['event']:<24} {e['replica']:<7} {e['decision']:<9} {e['reason']}")
    return lines


if __name__ == "__main__":
    print("\n".join(build_lines(sys.argv[1])))
```

```python
# file: tools/verify_audit.py
"""Verify the hash chain of an audit file. Usage: python tools/verify_audit.py results/<run_id>/audit.jsonl"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "controller"))

from app.audit import verify_chain  # noqa: E402

if __name__ == "__main__":
    ok, line, message = verify_chain(sys.argv[1])
    print("audit chain OK" if ok else f"audit chain BROKEN at line {line}: {message}")
    sys.exit(0 if ok else 1)
```

### 6.13 Tests that exercise the observer, replica and health check

These tests start real TLS replicas on local ports (no Docker) and use certificates produced by `gen_certs.sh`. The controller package is `app` (`controller/app`) and the replica package is `replica_app` (`replicas/replica_app`), so both can be imported in one test run.

```python
# file: replicas/tests/conftest.py
import os
import subprocess

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


@pytest.fixture(scope="session")
def certs(tmp_path_factory):
    out = tmp_path_factory.mktemp("certs")
    subprocess.run([os.path.join(ROOT, "certs", "gen_certs.sh"), str(out)], check=True,
                   stdout=subprocess.DEVNULL)
    return str(out)
```

```python
# file: replicas/tests/test_replica_observer.py
import asyncio
import os
import socket
import ssl
import time

import aiohttp
import pytest
from aiohttp import web

from app.monitor import check_once, data_path_context
from app.observer import observe
from app.models import Observation
from app.policy import evaluate, parse_policy
from replica_app.server import build_app, build_ssl_context

POLICY = parse_policy("""
version: 1
policy_id: lab-policy-001
allowed_locations: [IN]
location: {require_cert_label_match: true}
tls: {min_version: "1.2", enforcement: negotiated, require_trusted_cert: true}
logging: {mode: minimal, require_replica_minimal_logging: true}
""")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def start_replica(certs, replica_id, profile):
    from replica_app.server import PROFILES
    stem = f"{certs}/replica-{replica_id.lower()}-{PROFILES[profile]['cert']}"
    ctx = build_ssl_context(profile, stem + ".crt", stem + ".key")
    runner = web.AppRunner(build_app(replica_id, profile), access_log=None)
    await runner.setup()
    port = free_port()
    await web.TCPSite(runner, "127.0.0.1", port, ssl_context=ctx).start()
    return runner, port


@pytest.mark.parametrize("profile,expected", [
    ("compliant", ()),
    ("weak_tls", ("R5_TLS_BELOW_MIN",)),
    ("eu_weak_tls", ("R3_LOCATION_NOT_ALLOWED", "R5_TLS_BELOW_MIN")),
    ("wrong_location", ("R3_LOCATION_NOT_ALLOWED",)),
    ("label_mismatch", ("R4_LABEL_CERT_MISMATCH",)),
    ("verbose_logging", ("R6_LOGGING_NOT_MINIMAL",)),
])
async def test_profiles_produce_the_expected_decision(certs, profile, expected):
    runner, port = await start_replica(certs, "B", profile)
    try:
        obs = await observe("B", "127.0.0.1", port, "localhost", f"{certs}/ca.crt")
        decision = evaluate(POLICY, obs)
        assert decision.reasons == expected
        assert decision.passed == (expected == ())
    finally:
        await runner.cleanup()


async def test_unreachable_replica_is_r1(certs):
    obs = await observe("B", "127.0.0.1", free_port(), "localhost", f"{certs}/ca.crt")
    assert evaluate(POLICY, obs).reasons == ("R1_UNREACHABLE",)


async def test_wrong_ca_is_r2(certs, tmp_path):
    import subprocess
    other = tmp_path / "other"
    subprocess.run([os.path.join(os.path.dirname(__file__), "..", "..", "certs", "gen_certs.sh"), str(other)],
                   check=True, stdout=subprocess.DEVNULL)
    runner, port = await start_replica(certs, "B", "compliant")
    try:
        obs = await observe("B", "127.0.0.1", port, "localhost", str(other / "ca.crt"))
        assert evaluate(POLICY, obs).reasons == ("R2_CERT_UNTRUSTED",)
    finally:
        await runner.cleanup()


async def test_strict_mode_detects_legacy_support(certs):
    runner, port = await start_replica(certs, "B", "weak_tls")
    try:
        obs = await observe("B", "127.0.0.1", port, "localhost", f"{certs}/ca.crt",
                            min_version="1.2", check_legacy=True)
        assert "1.1" in obs.legacy_accepted
    finally:
        await runner.cleanup()


async def test_health_check_classification(certs):
    ca = f"{certs}/ca.crt"
    timeout = aiohttp.ClientTimeout(sock_connect=0.25, total=1.0)
    ctx = data_path_context(ca)
    good, port_good = await start_replica(certs, "A", "compliant")
    weak, port_weak = await start_replica(certs, "B", "weak_tls")
    try:
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=ctx), timeout=timeout) as s:
            ok, reason, _ = await check_once(s, f"https://localhost:{port_good}", 1000)
            assert (ok, reason) == (True, "-")
            ok, reason, _ = await check_once(s, f"https://localhost:{port_weak}", 1000)
            assert not ok and reason in ("TLS_ERROR", "CONNECT_ERROR")   # data path refuses TLS 1.1 (alert or reset)
            ok, reason, _ = await check_once(s, f"https://localhost:{free_port()}", 1000)
            assert (ok, reason) == (False, "CONNECT_REFUSED")      # crash
            # overload: deterministic degrade makes /health slower than the threshold
            async with s.post(f"https://localhost:{port_good}/lab/degrade", json={"delay_ms": 300},
                              headers={"X-Lab-Token": "lab-only-token"}):
                pass
            ok, reason, _ = await check_once(s, f"https://localhost:{port_good}", 200)
            assert (ok, reason) == (False, "LATENCY_EXCEEDED")
            async with s.post(f"https://localhost:{port_good}/lab/degrade", json={"delay_ms": 3000},
                              headers={"X-Lab-Token": "lab-only-token"}):
                pass
            ok, reason, _ = await check_once(s, f"https://localhost:{port_good}", 1000)
            assert (ok, reason) == (False, "READ_TIMEOUT")
    finally:
        await good.cleanup()
        await weak.cleanup()
```

### 6.14 Injectors

```bash
# file: injector/lib.sh
#!/usr/bin/env bash
# Shared helpers. Expects RUN_DIR (output directory) and RUN_ID to be set by the runner.
set -euo pipefail
: "${RUN_DIR:=./results/manual}"; : "${RUN_ID:=manual}"
mkdir -p "$RUN_DIR"

now_ts() { date -u +%Y-%m-%dT%H:%M:%S.%6NZ; }

# log_event <event> <replica A|B> <reason code>
log_event() {
  printf '{"ts":"%s","run_id":"%s","event":"%s","replica":"%s","decision":"-","reason":"%s"}\n' \
    "$(now_ts)" "$RUN_ID" "$1" "$2" "$3" >> "$RUN_DIR/injector.jsonl"
}

container_of() { case "$1" in A) echo replica-a ;; B) echo replica-b ;; *) echo "bad replica" >&2; exit 2 ;; esac; }
```

```bash
# file: injector/crash.sh
#!/usr/bin/env bash
# Usage: injector/crash.sh inject|cleanup A|B
. "$(dirname "$0")/lib.sh"
action="$1"; rid="$2"; c="$(container_of "$rid")"
case "$action" in
  inject)  docker kill "$c" >/dev/null; log_event fault_injected "$rid" FAULT_CRASH ;;
  verify)  [ "$(docker inspect -f '{{.State.Running}}' "$c")" = "false" ] ;;
  cleanup) docker compose up -d --force-recreate "$c" >/dev/null; log_event fault_cleared "$rid" FAULT_CRASH ;;
esac
```

```bash
# file: injector/linkloss.sh
#!/usr/bin/env bash
# Usage: injector/linkloss.sh inject|verify|cleanup A|B     (needs NET_ADMIN + iproute2 in the replica image)
. "$(dirname "$0")/lib.sh"
action="$1"; rid="$2"; c="$(container_of "$rid")"
case "$action" in
  inject)
    if docker exec "$c" tc qdisc add dev eth0 root netem loss 100% 2>/dev/null; then :
    else docker network disconnect lab-net "$c"; fi          # fallback when tc is unavailable
    log_event fault_injected "$rid" FAULT_LINKLOSS ;;
  verify)  docker exec "$c" tc qdisc show dev eth0 | grep -q netem ;;
  cleanup)
    docker exec "$c" tc qdisc del dev eth0 root 2>/dev/null || docker network connect lab-net "$c" 2>/dev/null || true
    log_event fault_cleared "$rid" FAULT_LINKLOSS ;;
esac
```

```bash
# file: injector/overload.sh
#!/usr/bin/env bash
# Usage: injector/overload.sh inject|cleanup A|B [deterministic|realistic]
. "$(dirname "$0")/lib.sh"
action="$1"; rid="$2"; mode="${3:-deterministic}"
c="$(container_of "$rid")"; port=$([ "$rid" = A ] && echo 9443 || echo 9444)
TOKEN="${LAB_TOKEN:-lab-only-token}"; CA="${CA_FILE:-certs/ca.crt}"
case "$action" in
  inject)
    if [ "$mode" = deterministic ]; then
      curl -s --cacert "$CA" -H "X-Lab-Token: $TOKEN" -H 'Content-Type: application/json' \
           -d '{"delay_ms":2500}' "https://localhost:$port/lab/degrade" >/dev/null
    else
      docker update --cpus 0.2 "$c" >/dev/null
      (hey -c 100 -z 20s --cacert "$CA" "https://localhost:$port/data" >/dev/null 2>&1 &)   # needs `hey`
    fi
    log_event fault_injected "$rid" FAULT_OVERLOAD ;;
  cleanup)
    curl -s --cacert "$CA" -H "X-Lab-Token: $TOKEN" -X POST "https://localhost:$port/lab/reset" >/dev/null || true
    docker update --cpus 0 "$c" >/dev/null 2>&1 || true
    log_event fault_cleared "$rid" FAULT_OVERLOAD ;;
esac
```

### 6.15 Scenarios and runner (skeleton)

```yaml
# file: scenarios/scenarios.yaml
defaults: {repeats: 10, warmup_s: 3, observe_s: 12, probe_interval_ms: 50, target: A}
scenarios:
  S1: {fault: crash,    b_profile: compliant,       expect: FAILOVER}
  S2: {fault: linkloss, b_profile: compliant,       expect: FAILOVER}
  S3: {fault: overload, b_profile: eu_weak_tls,     expect: REFUSED, reasons: "R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN"}
  S4: {fault: crash,    b_profile: weak_tls,        expect: REFUSED, reasons: "R5_TLS_BELOW_MIN"}
  S5: {fault: linkloss, b_profile: wrong_location,  expect: REFUSED, reasons: "R3_LOCATION_NOT_ALLOWED"}
  S6: {fault: overload, b_profile: compliant,       expect: FAILOVER}
  S7: {fault: crash,    b_profile: label_mismatch,  expect: REFUSED, reasons: "R4_LABEL_CERT_MISMATCH"}
  S8: {fault: crash,    b_profile: verbose_logging, expect: REFUSED, reasons: "R6_LOGGING_NOT_MINIMAL"}
```

```python
# file: scenarios/runner.py
"""Scenario runner (skeleton). One run = reset, warm up, probe, inject, observe, collect.
Usage: python scenarios/runner.py S1 [--repeats 10]"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

import yaml

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "probe"))
sys.path.insert(0, os.path.join(ROOT, "controller"))

from analyze import find_outages, load_probe, primary_outage, summarize   # noqa: E402
from app.audit import verify_chain                                        # noqa: E402


def sh(*cmd: str, env: dict | None = None) -> None:
    subprocess.run(cmd, check=True, cwd=ROOT, env={**os.environ, **(env or {})}, stdout=subprocess.DEVNULL)


def run_once(name: str, spec: dict, repeat: int, d: dict) -> dict:
    run_id = f"{name}-r{repeat:02d}"
    run_dir = os.path.join(ROOT, "results", run_id)
    os.makedirs(run_dir, exist_ok=True)
    env = {"RUN_ID": run_id, "RUN_DIR": run_dir, "REPLICA_B_PROFILE": spec["b_profile"]}

    # 1. clean state: recreate replicas (B with the chosen profile) and start a fresh controller run
    sh("docker", "compose", "up", "-d", "--force-recreate", "replica-a", "replica-b", env=env)
    sh("docker", "compose", "up", "-d", "--force-recreate", "controller", env=env)   # RUN_ID selects the audit directory
    time.sleep(d["warmup_s"])

    # 2. probe in the background, inject the fault, observe, clean up
    probe_path = os.path.join(run_dir, "probe.jsonl")
    probe = subprocess.Popen([sys.executable, os.path.join(ROOT, "probe", "probe.py"), "--out", probe_path,
                              "--duration-s", str(d["observe_s"] + 2), "--interval-ms", str(d["probe_interval_ms"])], cwd=ROOT)
    time.sleep(2)
    fault_ns = time.time_ns()
    sh(os.path.join(ROOT, "injector", f"{spec['fault']}.sh"), "inject", d["target"], env=env)
    time.sleep(d["observe_s"])
    probe.wait()
    sh(os.path.join(ROOT, "injector", f"{spec['fault']}.sh"), "cleanup", d["target"], env=env)

    # 3. analyse
    audit = os.path.join(ROOT, "results", run_id, "audit.jsonl")
    events = [json.loads(line) for line in open(audit, encoding="utf-8")]
    outcome = "FAILOVER" if any(e["event"] == "failover_done" for e in events) else "REFUSED"
    refused = next((e for e in events if e["event"] == "failover_refused"), None)
    outage = primary_outage(find_outages(load_probe(probe_path)), fault_ns, d["probe_interval_ms"])
    summary = {
        "run_id": run_id, "scenario": name, "repeat": repeat, "b_profile": spec["b_profile"],
        "outcome": outcome, "reasons": refused["reason"] if refused else "-",
        "downtime_ms": outage.downtime_ms if outage else None,
        "outage_open": outage.open if outage else None,
        "failed_requests": outage.failed_requests if outage else 0,
        "audit_chain_ok": verify_chain(audit)[0],
        "expected": spec["expect"], "ok": outcome == spec["expect"],
    }
    with open(os.path.join(run_dir, "summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
    return summary


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("scenario")
    ap.add_argument("--repeats", type=int)
    args = ap.parse_args()
    cfg = yaml.safe_load(open(os.path.join(ROOT, "scenarios", "scenarios.yaml"), encoding="utf-8"))
    spec, defaults = cfg["scenarios"][args.scenario], cfg["defaults"]
    runs = [run_once(args.scenario, spec, i + 1, defaults) for i in range(args.repeats or defaults["repeats"])]
    print(json.dumps({"scenario": args.scenario,
                      "downtime_ms": summarize([r["downtime_ms"] for r in runs if r["downtime_ms"] is not None]),
                      "all_as_expected": all(r["ok"] for r in runs)}, indent=2))
```

### 6.16 Container and build files

```dockerfile
# file: Dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY controller/ controller/
COPY replicas/ replicas/
ENV PYTHONUNBUFFERED=1
```

```yaml
# file: docker-compose.yml
services:
  controller:
    build: .
    working_dir: /srv/controller
    command: python -m app.main --config /etc/lab/controller.yaml
    environment:
      RUN_ID: ${RUN_ID:-run-0}
    volumes: ["./certs:/certs:ro", "./policy:/policy:ro", "./config:/etc/lab:ro", "./results:/results"]
    ports: ["8443:8443", "127.0.0.1:9000:9000"]
    networks: [lab-net]
    depends_on: [replica-a, replica-b]
  replica-a:
    build: .
    working_dir: /srv/replicas
    command: python -m replica_app.server
    environment: {REPLICA_ID: A, REPLICA_PROFILE: compliant, CERT_DIR: /certs, LAB_TOKEN: lab-only-token}
    cap_add: [NET_ADMIN]
    volumes: ["./certs:/certs:ro"]
    ports: ["127.0.0.1:9443:8443"]
    networks: [lab-net]
  replica-b:
    build: .
    working_dir: /srv/replicas
    command: python -m replica_app.server
    environment:
      REPLICA_ID: B
      REPLICA_PROFILE: ${REPLICA_B_PROFILE:-compliant}
      CERT_DIR: /certs
      LAB_TOKEN: lab-only-token
    cap_add: [NET_ADMIN]
    volumes: ["./certs:/certs:ro"]
    ports: ["127.0.0.1:9444:8443"]
    networks: [lab-net]
networks:
  lab-net: {name: lab-net}
```

```makefile
# file: Makefile
.PHONY: certs up down test demo matrix timeline clean
RUN ?= S1-r01

certs:
	bash certs/gen_certs.sh certs

up: certs
	docker compose up -d --build

down:
	docker compose down

test:
	python -m pytest -q

demo: up
	python scenarios/runner.py S1 --repeats 1
	python scenarios/runner.py S2 --repeats 1
	python scenarios/runner.py S3 --repeats 1
	python scenarios/runner.py S4 --repeats 1

matrix:
	for s in S1 S2 S3 S4 S5 S6 S7 S8; do python scenarios/runner.py $$s; done

timeline:
	python tools/timeline.py results/$(RUN)

clean:
	docker compose down -v; rm -rf results/*
```

```text
# file: .gitignore
certs/*.key
certs/*.crt
certs/*.srl
results/
.venv/
__pycache__/
```

## 7. Demo runbook (about 5 minutes)

Before the demo: `make up`, then confirm with `curl --cacert certs/ca.crt https://localhost:8443/data` that `X-Served-By: A` appears.

| Step | Command | What to say | What to show |
|---|---|---|---|
| 1 | `python tools/timeline.py results/S1-r01` after `python scenarios/runner.py S1 --repeats 1` | "Crash of A while B is compliant" | Timeline: `fault_injected`, `failure_detected`, `policy_evaluated PASS`, `failover_done`; downtime number |
| 2 | S2 the same way | "Link loss, B compliant" | Same order, longer detection (timeout based) |
| 3 | S3 | "Overload of A, but B is in the EU and speaks TLS 1.1" | `policy_evaluated FAIL R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN`, `failover_refused`, probe shows 503; zero requests served by B |
| 4 | S4 | "Only the TLS rule is broken this time" | Refusal with `R5_TLS_BELOW_MIN` |
| 5 | `python tools/verify_audit.py results/S3-r01/audit.jsonl` | "The log is tamper-evident" | `audit chain OK` |
| 6 | Show `policy/policy.yaml` and the pseudocode snippet | "Same input, same answer" | The 6-line policy and the failover loop |

The timeline output has this shape (illustrative, not a measurement):

```
     time  event                    replica decision  reason
  -2.000s  controller_started       -       -         -
  +0.000s  fault_injected           A       -         FAULT_CRASH
  +0.2xxs  failure_detected         A       UNHEALTHY CONNECT_ERROR
  +0.2xxs  policy_evaluated         B       PASS      -
  +0.2xxs  failover_done            B       SWITCHED  -
```

## 8. Report and pseudocode deliverables

The PDF follows `Proposed-structure-hackathon.pdf` (the same 11 sections as the presentation): title, abstract, background, literature and RFC review, proposed solution, solution optimization, architecture, data flow, deployment timeline, bibliography, thank you. Reuse the slides; add measured results to the optimization and timeline sections once the matrix has run.

One-page pseudocode snippet for the mentor (`docs/pseudocode.md`):

```
loop every interval:
    for each replica r:  ok, reason = health_check(r) ; update_health(r, ok, reason)

on active replica unhealthy:
    log(failure_detected, active, reason)
    candidate = other_replica(active)
    obs      = observe(candidate)                 # TLS handshake, /meta, certificate label
    decision = evaluate(policy, obs)              # pure: same input -> same output
    log(policy_evaluated, candidate, decision)
    if decision.passed and healthy(candidate):
        active = candidate ; epoch += 1 ; log(failover_done, candidate)
    else:
        log(failover_refused, candidate, decision.reasons) ; alert()
        fail_closed()                             # clients get 503, no traffic to a non-compliant replica

evaluate(policy, obs):
    if not obs.reachable:            return FAIL [R1]
    if not obs.cert_trusted:         return FAIL [R2]
    reasons = []
    if obs.location not in policy.allowed_locations:      reasons += [R3]
    if obs.location != obs.cert_location:                 reasons += [R4]
    if obs.tls_version < policy.min_tls_version:          reasons += [R5]
    if obs.logging != "minimal":                          reasons += [R6]
    return PASS if no reasons else FAIL reasons
```

## 9. Risks, spikes and fallbacks (build-time view)

| Risk | Spike or check | Fallback |
|---|---|---|
| Docker image blocks TLS 1.1 | In M0, run the observer test inside the image | `OPENSSL_CONF` override (System Design 8.5); then TLS 1.2 cap plus policy minimum 1.3; then update the slides |
| `tc netem` not available | `docker exec replica-a tc qdisc add ...` | `docker network disconnect` (already coded as a fallback in `linkloss.sh`) |
| Name resolution error after container kill makes detection slower or odd | Record the reason code seen after `docker kill` | Classified as `CONNECT_ERROR`; if it is slow, set the controller to use fixed container IPs |
| Overload not repeatable | Run the deterministic variant 10 times | Use the deterministic variant for headline numbers |
| Probe sees noise from the host | Run probe on an idle machine; repeat runs | Report p95 and the ±50 ms resolution |

## 10. Suggested work split (adjust to your strengths)

| Owner | Focus | Milestones |
|---|---|---|
| Teammate 1 | Controller internals: policy, observer, monitor, manager, front door, audit, admin API | M2, M3, M6 |
| Teammate 2 | Infrastructure and measurement: PKI, replicas, Docker, injectors, probe, analyzer, runner, results | M1, M4, M5 |
| Both | M0 spikes, demo rehearsal, report | M0, M7 |

The mentor can be given the PRD and the traceability matrix to confirm scope early.

## 11. What was actually run for this document

Every code block that starts with `# file:` was extracted from this document into a scratch directory and executed in a sandbox (Python 3.13, OpenSSL 3.0.13, aiohttp 3.14, **no Docker daemon**).

| Check | Result |
|---|---|
| Automated tests (`pytest`) | **52 passed**: policy rules R1 to R6, determinism over 1000 evaluations, strict mode, policy validation, audit chain and tamper detection, allow-list, health thresholds, downtime analyzer, all six replica profiles through the real observer, wrong-CA case (R2), unreachable replica (R1), health-check classification (healthy, TLS 1.1 refused, crash, latency, read timeout) |
| End-to-end, crash of A, B `compliant` | Failover to B with epoch 0 to 1; one failed probe request; audit chain valid; event order `failure_detected`, `policy_evaluated PASS`, `failover_done` |
| End-to-end, crash of A, B `eu_weak_tls` | `failover_refused` with `R3_LOCATION_NOT_ALLOWED+R5_TLS_BELOW_MIN`; probe saw 503 until the end of the run; **no request served by B**; chain valid |
| End-to-end, crash of A, B `weak_tls` | Refused with `R5_TLS_BELOW_MIN`; same safety result |
| End-to-end, crash of A, B `label_mismatch` | Refused with `R4_LABEL_CERT_MISMATCH` |
| `bash -n` on all scripts, `py_compile`, YAML load, `docker compose config`, `make -n demo` | Passed |

**Problems found and fixed while doing this** (so you do not meet them again):

1. Python 3.13's default TLS context is strict and rejected our first lab CA because it had no `keyUsage` extension. `gen_certs.sh` now creates a proper CA and leaf extensions.
2. A strict client talking to a TLS 1.1-only server sees a *connection reset*, not a named TLS error, so such a replica's health reason is `CONNECT_ERROR`. The policy observer still reports the real reason (`R5_TLS_BELOW_MIN`).
3. The replica and controller packages were both called `app`; the replica package is now `replica_app`.

**Do not quote the local timings as results.** The end-to-end runs used local processes on one machine, so detection and failover took tens of milliseconds there. Real numbers come from the Docker runs in milestones M4 and M5.

**Known rough edge.** While the service is unavailable and a replica is healthy but non-compliant, the manager re-evaluates it every `reevaluate_interval_ms` and writes one `policy_evaluated` event each time. Suppressing repeated identical decisions is a small improvement for later.

## 12. Stretch goals

1. Periodic re-evaluation of the active replica; fail closed if it stops being compliant.
2. `hold_and_retry` mode and a stall-time metric.
3. `no_legacy_support` strict TLS mode in the demo (already supported by the observer and policy engine).
4. Live dashboard page fed by `/admin/state` and `/admin/timeline`.
5. Controller high-availability sketch in the report.
6. Policy replay tool: feed recorded observations to `evaluate()` and compare with the audit log.

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| TLS alert or `ConnectionResetError` from the controller to B | Expected for weak profiles: the strict data path refuses TLS 1.1 | Nothing to fix; the policy observer shows the real reason |
| Observer cannot negotiate TLS 1.1 | Distribution OpenSSL config sets a TLS 1.2 minimum | Use the `OPENSSL_CONF` override |
| `certificate verify failed` | CA not mounted, wrong host name, or expired certificate (10-day validity) | Rerun `make certs`; check SANs |
| `CA cert does not include key usage extension` (Python 3.13+) | The default Python context is strict (`VERIFY_X509_STRICT`) and the CA lacks `keyUsage` | Use the `gen_certs.sh` in this document, which adds `basicConstraints`, `keyUsage` and `extendedKeyUsage` |
| Probe shows 502 for a long time after a crash | Thresholds too high or health interval too long | Check `health.*` values; confirm passive detection is wired |
| Controller returns 503 at startup | No replica passed policy | Read `results/<run>/audit.jsonl` for the reason codes |
| `tc: Operation not permitted` | Container lacks `NET_ADMIN` | Confirm `cap_add: [NET_ADMIN]` |
| Downtime varies a lot | Noisy host, or overload variant used | Close other workloads; use the deterministic overload |
| Audit verification fails | File was edited or run files were mixed | Rerun the scenario; one audit file per run |
