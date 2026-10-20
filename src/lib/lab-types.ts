/** Client-side lab types — mirrors docs/06-api-contracts.md (the contract is the source of truth). */

export type HealthState = "UNKNOWN" | "HEALTHY" | "UNHEALTHY";
export type Mode = "STARTING" | "SERVING" | "EVALUATING" | "UNAVAILABLE";
export type ReplicaId = "A" | "B";
export type FaultKind = "CRASH" | "LINK_LOSS" | "OVERLOAD";

export interface AuditRecord {
  seq: number;
  ts: string;
  runId: string;
  event: string;
  replica: ReplicaId | "-";
  decision: string;
  reason: string;
  policy: string;
  prev: string;
  hash: string;
}

export interface ProbeResult {
  seq: number;
  tSendNs: number;
  tRecvNs: number;
  status: number | null;
  ok: boolean;
  latencyMs: number | null;
  servedBy: ReplicaId | null;
  epoch: number | null;
  error: string | null;
}

export interface HealthTick {
  replica: ReplicaId;
  ok: boolean;
  reason: string;
  latencyMs: number | null;
  health: HealthState;
  consecutiveFails: number;
  atNs: number;
}

export interface ReplicaView {
  id: ReplicaId;
  profile: string;
  location: string;
  certLocation: string;
  tlsMin: string;
  tlsMax: string;
  loggingClaim: "minimal" | "verbose";
  health: HealthState;
  lastReason: string;
  lastLatencyMs: number | null;
  consecutiveFails: number;
  fault: FaultKind | null;
  lastDecision: { passed: boolean; reasons: string[]; atIso: string | null } | null;
}

export interface PolicySummary {
  id: string;
  sha: string;
  minVersion: string;
  enforcement: string;
  allowedLocations: string[];
  requireCertLabelMatch: boolean;
  requireMinimalLogging: boolean;
  yaml?: string;
}

export interface ScenarioRunStatus {
  running: boolean;
  scenario: string | null;
  repeat: number;
  repeats: number;
  phase: string | null;
  phaseStartedIso: string | null;
  runId: string | null;
  batchId: string | null;
  progress: number;
  cancelled?: boolean;
  lastSummary: RunSummary | null;
}

export interface RunSummary {
  runId: string;
  scenario: string;
  repeat: number;
  bProfile: string;
  outcome: string;
  reasons: string;
  downtimeMs: number | null;
  outageOpen: boolean | null;
  detectMs: number | null;
  decideMs: number | null;
  switchMs: number | null;
  servedByNoncompliant: number;
  auditChainOk: boolean;
  auditOrderOk: boolean;
  scoreTotal: number;
  grade: string;
  passedExpectation: boolean;
}

export interface LabSnapshot {
  runId: string;
  mode: Mode;
  active: ReplicaId | null;
  epoch: number;
  runLock: boolean;
  safetyViolations: number;
  startedAt: string;
  policy: PolicySummary;
  controller: Record<string, number>;
  replicas: ReplicaView[];
  recentAudit: AuditRecord[];
  recentProbe: ProbeResult[];
  recentHealth: Record<ReplicaId, HealthTick[]>;
  probeStats: {
    intervalMs: number;
    okRate: number | null;
    liveDowntimeMs: number | null;
    liveOutageOpen: boolean | null;
  };
  scenarioStatus: ScenarioRunStatus | null;
}

export type LabEventType = "state" | "audit" | "probe" | "health" | "fault" | "policy" | "run";

export interface LabEvent {
  type: LabEventType;
  payload: unknown;
  ts: string;
}

export interface ScenarioCard {
  key: string;
  title: string;
  fault: string;
  bProfile: string;
  expect: string;
  headline: boolean;
  runs: number;
  passRate: number | null;
  downtime: {
    count: number;
    mean: number | null;
    p50: number | null;
    p95: number | null;
    min: number | null;
    max: number | null;
  };
  meanDetectMs: number | null;
  meanScore: number | null;
  bestGrade: string | null;
  violations: number;
}

export const FAULT_LABEL: Record<FaultKind, string> = {
  CRASH: "Process crash",
  LINK_LOSS: "Link loss",
  OVERLOAD: "Overload",
};

export const PROFILE_LABEL: Record<string, string> = {
  compliant: "compliant",
  weak_tls: "weak TLS",
  eu_weak_tls: "EU + weak TLS",
  wrong_location: "wrong location",
  label_mismatch: "label mismatch",
  verbose_logging: "verbose logging",
  untrusted_cert: "untrusted cert (R2)",
};

export const PROFILE_KEYS = [
  "compliant",
  "weak_tls",
  "eu_weak_tls",
  "wrong_location",
  "label_mismatch",
  "verbose_logging",
  "untrusted_cert",
] as const;
