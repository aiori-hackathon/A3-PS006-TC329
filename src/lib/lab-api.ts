/** Typed fetch helpers for the INTERLOCK API (docs/06-api-contracts.md). */

import type {
  AuditRecord,
  LabSnapshot,
  PolicySummary,
  RunSummary,
  ScenarioRunStatus,
} from "./lab-types";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(path, {
    credentials: "include", // Include HttpOnly session cookie
    ...init,
    headers,
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) {
    let msg = data.message ?? data.error ?? `request failed (${res.status})`;
    if (res.status === 401) {
      msg = "Operator login required. Tap 🔓 'login' in the top bar to authenticate.";
    }
    throw new ApiError(msg, res.status, data.error);
  }
  return data;
}

export const api = {
  login: (key: string) =>
    req<{ ok: boolean; user: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ key }),
    }),

  logout: () =>
    req<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
    }),

  session: () =>
    req<{ authenticated: boolean; user: string | null }>("/api/auth/session"),

  state: () => req<LabSnapshot>("/api/lab/state"),

  fault: (replica: "A" | "B", fault: string, action: "inject" | "clear") =>
    req<{ ok: boolean }>("/api/lab/fault", {
      method: "POST",
      body: JSON.stringify({ replica, fault, action }),
    }),

  profile: (profile: string) =>
    req<{ ok: boolean; applied: string }>("/api/lab/profile", {
      method: "POST",
      body: JSON.stringify({ replica: "B", profile }),
    }),

  switch: (to: "A" | "B") =>
    req<{ result: string; epoch: number; reasons: string[] }>("/api/lab/switch", {
      method: "POST",
      body: JSON.stringify({ to }),
    }),

  reset: () => req<{ ok: boolean; runId: string }>("/api/lab/reset", { method: "POST" }),

  policy: () =>
    req<{
      yaml: string;
      parsed: PolicySummary;
      history: { sha: string; atIso: string; active: boolean }[];
    }>("/api/policy"),

  validatePolicy: (yaml: string) =>
    req<{ valid: boolean; sha?: string; parsed?: PolicySummary; error?: string }>(
      "/api/policy/validate",
      { method: "POST", body: JSON.stringify({ yaml }) },
    ),

  reloadPolicy: (yaml: string) =>
    req<{ ok: boolean; sha?: string; parsed?: PolicySummary; error?: string }>(
      "/api/policy/reload",
      { method: "POST", body: JSON.stringify({ yaml }) },
    ),

  audit: (runId?: string | null, limit = 300) =>
    req<{ events: AuditRecord[]; runIds: string[] }>(
      `/api/audit?limit=${limit}${runId ? `&runId=${encodeURIComponent(runId)}` : ""}`,
    ),

  verifyChain: (runId?: string | null) =>
    req<{ ok: boolean; problemLine: number | null; message: string; count?: number; runId?: string }>(
      `/api/audit/verify${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`,
    ),

  /** Demo: rewrite one persisted audit row of this run to prove the chain catches it. */
  tamperChain: (runId: string) =>
    req<{ ok: boolean; runId: string; seq: number; event: string; from: string; to: string; line: number }>(
      "/api/audit/tamper",
      { method: "POST", body: JSON.stringify({ runId }) },
    ),

  /** Demo: write the original row back after tamperChain. */
  restoreChain: () =>
    req<{ ok: boolean; runId: string; seq: number }>("/api/audit/restore", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  runs: (limit = 60) => req<{ runs: RunSummaryLike[] }>(`/api/runs?limit=${limit}`),

  runDetail: (runId: string) => req<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`),

  matrix: () =>
    req<{
      scenarios: {
        key: string;
        title: string;
        fault: string;
        bProfile: string;
        expect: string;
        headline: boolean;
        runs: number;
        passRate: number | null;
        downtime: { count: number; mean: number | null; p50: number | null; p95: number | null; min: number | null; max: number | null };
        meanDetectMs: number | null;
        meanScore: number | null;
        bestGrade: string | null;
        violations: number;
      }[];
    }>("/api/analytics/matrix"),

  startScenario: (scenario: string, repeats: number) =>
    req<{ ok: boolean }>("/api/scenario/start", {
      method: "POST",
      body: JSON.stringify({ scenario, repeats }),
    }),

  scenarioStatus: () => req<{ status: ScenarioRunStatus | null }>("/api/scenario/status"),

  cancelScenario: () => req<{ ok: boolean }>("/api/scenario/cancel", { method: "POST" }),
};

/** Rows in /api/runs (historical runs from the DB). */
export interface RunSummaryLike {
  id: string;
  scenario: string;
  repeat: number;
  fault: string;
  bProfile: string;
  expect: string;
  outcome: string | null;
  reasons: string | null;
  downtimeMs: number | null;
  outageOpen: boolean | null;
  detectMs: number | null;
  decideMs: number | null;
  switchMs: number | null;
  servedByNoncompliant: number | null;
  auditChainOk: boolean | null;
  auditOrderOk: boolean | null;
  scoreTotal: number | null;
  grade: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

export interface RunDetail {
  run: {
    id: string;
    scenario: string;
    repeat: number;
    fault: string;
    bProfile: string;
    expect: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    tFaultIso: string | null;
    detectMs: number | null;
    decideMs: number | null;
    switchMs: number | null;
    outcome: string | null;
    reasons: string | null;
    downtimeMs: number | null;
    outageOpen: boolean | null;
    servedByNoncompliant: number | null;
    auditChainOk: boolean | null;
    auditOrderOk: boolean | null;
    scoreTotal: number | null;
    grade: string | null;
  };
  score: {
    total: number;
    grade: string;
    components: { key: string; label: string; points: number; maxPoints: number; note: string }[];
  };
  timeline: { tsIso: string; offsetMs: number; event: string; replica: string; decision: string; reason: string }[];
  probe: {
    seq: number;
    tSendNs: number;
    ok: boolean;
    status: number | null;
    latencyMs: number | null;
    servedBy: string | null;
    epoch: number | null;
    error: string | null;
  }[];
  audit: AuditRecord[];
}
