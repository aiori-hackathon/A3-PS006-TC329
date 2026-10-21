/**
 * INTERLOCK engine — core data model (server-only).
 * Mirrors PS-006 System Design §4 (RouteTable, Observation, Decision).
 * Client-facing types live in src/lib/lab-types.ts (contract: docs/06-api-contracts.md).
 */

export type HealthState = "UNKNOWN" | "HEALTHY" | "UNHEALTHY";
export type Mode = "STARTING" | "SERVING" | "EVALUATING" | "UNAVAILABLE";
export type ReplicaId = "A" | "B";
export type FaultKind = "CRASH" | "LINK_LOSS" | "OVERLOAD";

export type ReasonCode =
  | "R1_UNREACHABLE"
  | "R2_CERT_UNTRUSTED"
  | "R3_LOCATION_NOT_ALLOWED"
  | "R4_LABEL_CERT_MISMATCH"
  | "R5_TLS_BELOW_MIN"
  | "R6_LOGGING_NOT_MINIMAL";

export type HealthReason =
  | "-"
  | "CONNECT_REFUSED"
  | "CONNECT_TIMEOUT"
  | "CONNECT_ERROR"
  | "READ_TIMEOUT"
  | "LATENCY_EXCEEDED"
  | "TLS_ERROR"
  | "HTTP_STATUS";

/** Immutable route snapshot; replaced atomically by the manager (single writer). */
export interface RouteTable {
  mode: Mode;
  active: ReplicaId | null;
  epoch: number;
}

/** Facts about a candidate replica gathered by the (tolerant) observer. */
export interface Observation {
  replicaId: ReplicaId;
  reachable: boolean;
  certTrusted: boolean;
  tlsVersion: string | null; // "1.0" | "1.1" | "1.2" | "1.3"
  declaredLocation: string | null;
  certLocation: string | null;
  declaredLogging: string | null;
  legacyAccepted: readonly string[] | null;
}

/** Result of the pure policy evaluation. */
export interface Decision {
  replicaId: ReplicaId;
  passed: boolean;
  reasons: readonly ReasonCode[];
  policyId: string;
  policySha: string;
}

/** One allow-listed, hash-chained audit row (PS-006 schema §7.3). */
export interface AuditRecord {
  seq: number;
  ts: string; // ISO 8601 UTC
  runId: string;
  event: AuditEventName;
  replica: ReplicaId | "-";
  decision: AuditDecision;
  reason: string; // enumerated codes joined by "+" or "-"
  policy: string; // 12-hex hash or "-"
  prev: string; // 64-hex
  hash: string; // 64-hex
  algo?: "v1-sha256" | "v2-hmac-sha256"; // absent = v1-sha256 (backward compat)
}

export type AuditEventName =
  | "controller_started"
  | "policy_loaded"
  | "policy_load_failed"
  | "health_changed"
  | "failure_detected"
  | "policy_evaluated"
  | "failover_done"
  | "failover_refused"
  | "service_unavailable"
  | "service_restored"
  | "admin_switch_requested"
  | "fault_injected"
  | "fault_cleared";

export type AuditDecision =
  | "HEALTHY"
  | "UNHEALTHY"
  | "PASS"
  | "FAIL"
  | "SWITCHED"
  | "REFUSED"
  | "UP"
  | "DOWN"
  | "-";

/** One probe result (probe.jsonl schema, PS-006 §7.4). */
export interface ProbeResult {
  seq: number;
  tSendNs: number;
  tRecvNs: number;
  status: number | null;
  ok: boolean;
  latencyMs: number | null;
  servedBy: ReplicaId | null;
  epoch: number | null;
  error: string | null; // "timeout" | "conn_error" | "tls_error" | "http_status" | null
}

/** One health-check tick (live telemetry only; not persisted). */
export interface HealthTick {
  replica: ReplicaId;
  ok: boolean;
  reason: HealthReason;
  latencyMs: number | null;
  health: HealthState;
  consecutiveFails: number;
  atNs: number;
}

/** Replica facts visible in the console. */
export interface ReplicaFacts {
  id: ReplicaId;
  profile: string;
  location: string; // declared /meta label
  certLocation: string; // SAN URI label
  tlsMin: string;
  tlsMax: string;
  loggingClaim: "minimal" | "verbose";
}

/** Engine config (defaults from PS-006 System Design §7.2). */
export const ENGINE_CONFIG = {
  healthIntervalMs: 100,
  connectTimeoutMs: 250,
  readTimeoutMs: 1500,
  latencyThresholdMs: 1000,
  failureThreshold: 2,
  recoveryThreshold: 3,
  decisionTimeoutMs: 500,
  reevaluateIntervalMs: 2000,
  probeIntervalMs: 50,
  idleProbeIntervalMs: 200,
  upstreamReadTimeoutMs: 1000,
  overloadDelayMs: 2500,
  warmupMs: 3000,
  observeMs: 12000,
  restoreAtMs: 6000, // S9: replica A restarted this long after the fault
  settleMs: 600,
  holdAndRetryEnabled: false,
  holdTimeoutMs: 2000,
  retryIntervalMs: 200,
} as const;

export type EngineConfig = typeof ENGINE_CONFIG;
