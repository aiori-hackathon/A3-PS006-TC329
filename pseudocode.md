# PS-006 Policy-Constrained Failover: Pseudocode Specification

> **Mentor / Evaluator Reference Document** — AIORI Hackathon 3  
> **Team:** Algo-Ancesstors (`A3-PS006-TC329`)  
> **Traceability:** PRD §7.6 (FR-54), Architecture §5, Engineering Scope §11

---

## 1. Top-Level Failover Controller Event Loop

```text
ALGORITHM FailoverController(initial_active, policy, replicas, monitor_cfg)
  INPUT: 
    initial_active ∈ {"A", "B"}
    policy: Validated policy spec {location, tlsMin, allowLogging, ...}
    replicas: Map of replica IDs to endpoints
  STATE:
    route ← { mode: "STARTING", active: null, epoch: 0 }
    audit_chain ← SHA256(GENESIS_BLOCK)
    event_queue ← Queue()

  ON INITIALIZE:
    candidate ← initial_active
    obs ← TolerantObserve(candidate)
    decision ← PolicyGate(policy, obs)
    IF decision.passed AND HealthStatus(candidate) == HEALTHY THEN
      route ← { mode: "SERVING", active: candidate, epoch: 0 }
      AuditEmit("controller_started", replica=candidate, decision="PASS")
    ELSE
      route ← { mode: "UNAVAILABLE", active: null, epoch: 0 }
      AuditEmit("service_unavailable", replica="-", decision="DOWN")
    END IF

  MAIN EVENT LOOP:
    WHILE controller_running DO
      event ← event_queue.pop()
      MATCH event WITH
        | HEALTH_CHANGED(replica_id, new_state, reason):
            HandleHealthChange(replica_id, new_state, reason)

        | ADMIN_SWITCH(target_replica):
            HandleAdminSwitch(target_replica)

        | PERIODIC_REEVALUATE():
            IF route.mode == "UNAVAILABLE" THEN
              ReevaluateForRecovery()
            END IF
      END MATCH
    END WHILE
END ALGORITHM
```

---

## 2. Health Monitoring & Passive Failure Detection

```text
ALGORITHM HealthMonitorLoop(replica_id, interval_ms, fail_thresh=2, recov_thresh=3)
  STATE:
    consecutive_fails ← 0
    consecutive_successes ← 0
    current_state ← UNKNOWN

  EVERY interval_ms DO
    result ← STRICT_TLS_CHECK(replica_id, "/health", timeout=250ms)
    
    IF result.ok AND result.latency_ms <= 1000ms THEN
      consecutive_fails ← 0
      consecutive_successes ← consecutive_successes + 1
      IF consecutive_successes >= recov_thresh AND current_state != HEALTHY THEN
        current_state ← HEALTHY
        event_queue.push(HEALTH_CHANGED(replica_id, HEALTHY, "-"))
      END IF
    ELSE
      consecutive_successes ← 0
      consecutive_fails ← consecutive_fails + 1
      IF consecutive_fails >= fail_thresh AND current_state != UNHEALTHY THEN
        current_state ← UNHEALTHY
        event_queue.push(HEALTH_CHANGED(replica_id, UNHEALTHY, result.reason))
      END IF
    END IF
  END EVERY

  ON PASSIVE_PROXY_FAILURE(replica_id, error_kind):
    // Accelerated detection: immediate probe on connection or TLS error
    consecutive_fails ← consecutive_fails + 1
    TRIGGER_IMMEDIATE_PROBE(replica_id)
END ALGORITHM
```

---

## 3. Policy Gate Evaluation (Rules R1 – R6)

```text
ALGORITHM PolicyGate(policy, obs)
  INPUT:
    policy: { allowedLocations: ["IN"], tlsMinVersion: "1.2", 
              allowVerboseLogging: false, tlsEnforcement: "standard" | "no_legacy_support" }
    obs: { replicaId, reachable, certTrusted, tlsVersion, 
           declaredLocation, certLocation, declaredLogging, legacyAccepted }
  OUTPUT:
    decision: { passed: boolean, reasons: List[ReasonCode], policySha: string }

  reasons ← []

  // R1: Reachability short-circuit
  IF NOT obs.reachable THEN
    RETURN { passed: false, reasons: ["R1_UNREACHABLE"], policySha: policy.sha256 }
  END IF

  // R2: Certificate Lab-CA trust short-circuit
  IF NOT obs.certTrusted THEN
    RETURN { passed: false, reasons: ["R2_CERT_UNTRUSTED"], policySha: policy.sha256 }
  END IF

  // R3: Geolocation residency constraint
  IF obs.declaredLocation NOT IN policy.allowedLocations OR 
     obs.certLocation NOT IN policy.allowedLocations THEN
    reasons.append("R3_LOCATION_NOT_ALLOWED")
  END IF

  // R4: Location cryptographic integrity (Metadata vs SAN URI)
  IF obs.declaredLocation != obs.certLocation THEN
    reasons.append("R4_LABEL_CERT_MISMATCH")
  END IF

  // R5: Cryptographic baseline (minimum TLS 1.2)
  IF VersionTuple(obs.tlsVersion) < VersionTuple(policy.tlsMinVersion) THEN
    reasons.append("R5_TLS_BELOW_MIN")
  END IF
  IF policy.tlsEnforcement == "no_legacy_support" AND obs.legacyAccepted.length > 0 THEN
    reasons.append("R5_TLS_BELOW_MIN")
  END IF

  // R6: Data privacy & logging posture
  IF obs.declaredLogging == "verbose" AND NOT policy.allowVerboseLogging THEN
    reasons.append("R6_LOGGING_NOT_MINIMAL")
  END IF

  passed ← (reasons.length == 0)
  RETURN { passed: passed, reasons: reasons, policySha: policy.sha256 }
END ALGORITHM
```

---

## 4. Failover Handler with Hold-and-Retry and Fail-Closed Safety

```text
ALGORITHM HandleHealthChange(failed_replica, new_state, fail_reason)
  IF new_state == UNHEALTHY AND route.mode == "SERVING" AND route.active == failed_replica THEN
    AuditEmit("failure_detected", replica=failed_replica, decision="UNHEALTHY", reason=fail_reason)
    route.mode ← "EVALUATING"
    
    candidate ← (failed_replica == "A") ? "B" : "A"
    obs ← TolerantObserve(candidate)
    decision ← PolicyGate(policy, obs)

    IF decision.passed AND HealthStatus(candidate) == HEALTHY THEN
      // Success: Atomic route switch (Safety Invariant SI-2)
      route.epoch ← route.epoch + 1
      route.active ← candidate
      route.mode ← "SERVING"
      AuditEmit("policy_evaluated", replica=candidate, decision="PASS", policy=decision.policySha)
      AuditEmit("failover_done", replica=candidate, decision="SWITCHED", policy=decision.policySha)
      BroadcastRouteTable(route)
    ELSE
      // Hold-and-Retry check (FR-19)
      IF config.holdAndRetryEnabled THEN
        AuditEmit("hold_and_retry_started", replica=candidate, decision="HOLD")
        start_time ← Now()
        WHILE (Now() - start_time) < config.holdTimeoutMs DO
          Sleep(config.retryIntervalMs)
          obs ← TolerantObserve(candidate)
          decision ← PolicyGate(policy, obs)
          IF decision.passed AND HealthStatus(candidate) == HEALTHY THEN
            route.epoch ← route.epoch + 1
            route.active ← candidate
            route.mode ← "SERVING"
            AuditEmit("failover_done", replica=candidate, decision="SWITCHED")
            BroadcastRouteTable(route)
            RETURN
          END IF
        END WHILE
      END IF

      // Candidate rejected: FAIL-CLOSED (Invariant SI-1)
      AuditEmit("policy_evaluated", replica=candidate, decision="FAIL", reason=decision.reasons)
      AuditEmit("failover_refused", replica=candidate, decision="REFUSED", reason=decision.reasons)
      route.active ← null
      route.mode ← "UNAVAILABLE"
      AuditEmit("service_unavailable", replica="-", decision="DOWN", reason="NO_COMPLIANT_REPLICA")
      BroadcastRouteTable(route)
    END IF
  END IF
END ALGORITHM
```

---

## 5. Tamper-Evident Hash Chain Audit Logger

```text
ALGORITHM AuditAppend(event_name, replica, decision, reason="-", policy_sha="-")
  seq ← next_seq++
  ts ← UTC_ISO8601()
  
  // Canonical formatting: exact allowlisted fields in invariant JSON key order
  canonical_body ← CanonicalJSON({
    seq: seq,
    ts: ts,
    runId: current_run_id,
    event: event_name,
    replica: replica,
    decision: decision,
    reason: reason,
    policy: policy_sha
  })

  // Hash link: SHA-256(prev_hash + canonical_body)
  current_hash ← SHA256(prev_hash + canonical_body)
  
  record ← { ...canonical_body, prev: prev_hash, hash: current_hash }
  prev_hash ← current_hash
  AppendLogFile(record)
  EmitRealtime(record)
END ALGORITHM
```

---

## 6. Front Door Proxy and Downtime Probe

```text
ALGORITHM FrontDoorProxy(client_request)
  IF route.mode == "SERVING" AND route.active != null THEN
    // Proxy request through strict TLS connection to active replica
    response ← ForwardHTTPS(route.active, client_request)
    IF response.is_network_failure THEN
      HealthMonitor.RecordPassiveFailure(route.active)
      RETURN HTTP_502_BAD_GATEWAY
    END IF
    RETURN response
  ELSE
    // Fail closed: Never route to non-compliant or unverified destination
    RETURN HTTP_503_SERVICE_UNAVAILABLE("Service Unavailable: No Compliant Replica")
  END IF
END ALGORITHM

ALGORITHM MeasureDowntime(probe_results)
  // Continuous 50 ms absolute-interval probing
  outages ← []
  current_outage ← null
  
  FOR probe IN probe_results DO
    IF NOT probe.ok AND current_outage == null THEN
      current_outage ← { start_ns: probe.tSendNs }
    ELSE IF probe.ok AND current_outage != null THEN
      current_outage.end_ns ← probe.tSendNs
      current_outage.duration_ms ← (current_outage.end_ns - current_outage.start_ns) / 1,000,000
      outages.append(current_outage)
      current_outage ← null
    END IF
  END FOR

  RETURN {
    total_downtime_ms: Sum(o.duration_ms for o in outages),
    primary_failover_downtime_ms: outages[0]?.duration_ms ?? 0,
    outage_count: outages.length
  }
END ALGORITHM
```
