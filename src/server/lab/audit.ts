/**
 * Audit log — allow-listed, hash-chained JSON Lines port of PS-006 `controller/app/audit.py`.
 * v1-sha256 (default):  hash = SHA-256(prev + canonical(body))
 * v2-hmac-sha256 (opt): hash = HMAC-SHA-256(key=AUDIT_HMAC_KEY, data=prev+canonical(body))
 * Algorithm is chosen at log construction time; verifyChain auto-detects per record.
 * Unknown kwargs are dropped (allow-list). Free-text reasons are impossible.
 */

import { createHash, createHmac } from "crypto";
import type { AuditDecision, AuditEventName, AuditRecord, ReplicaId } from "./models";

export type { AuditRecord };

export const GENESIS = "0".repeat(64);
const FIELDS = ["seq", "ts", "run_id", "event", "replica", "decision", "reason", "policy"] as const;

const EVENTS: ReadonlySet<string> = new Set([
  "controller_started", "policy_loaded", "policy_load_failed", "health_changed",
  "failure_detected", "policy_evaluated", "failover_done", "failover_refused",
  "service_unavailable", "service_restored", "admin_switch_requested",
  "fault_injected", "fault_cleared",
]);
const DECISIONS: ReadonlySet<string> = new Set([
  "HEALTHY", "UNHEALTHY", "PASS", "FAIL", "SWITCHED", "REFUSED", "UP", "DOWN", "-",
]);
const REPLICAS: ReadonlySet<string> = new Set(["A", "B", "-"]);
const REASON_RE = /^(-|[A-Z0-9_]+(\+[A-Z0-9_]+)*)$/;
const POLICY_RE = /^(-|[0-9a-f]{12})$/;

export function canonical(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) sorted[key] = obj[key];
  return JSON.stringify(sorted);
}

export type AuditAlgo = "v1-sha256" | "v2-hmac-sha256";

/** Compute chain hash using plain SHA-256 (v1, no secret). */
export function chainHash(prev: string, body: Record<string, unknown>): string {
  return createHash("sha256").update(prev + canonical(body), "utf-8").digest("hex");
}

/** Compute chain hash using HMAC-SHA-256 (v2, keyed). */
export function chainHmac(key: string, prev: string, body: Record<string, unknown>): string {
  return createHmac("sha256", key).update(prev + canonical(body), "utf-8").digest("hex");
}

/** Resolve algorithm and optional HMAC key from env. */
function resolveAlgo(): { algo: AuditAlgo; hmacKey: string | null } {
  const hmacKey = process.env.AUDIT_HMAC_KEY ?? null;
  if (hmacKey && hmacKey.length >= 32) return { algo: "v2-hmac-sha256", hmacKey };
  return { algo: "v1-sha256", hmacKey: null };
}

export interface AuditEmitOptions {
  replica?: ReplicaId | "-";
  decision?: AuditDecision;
  reason?: string;
  policy?: string;
  [dropped: string]: unknown; // extra fields are accepted and DROPPED (allow-list)
}

export class AuditLog {
  readonly runId: string;
  private rows: AuditRecord[] = [];
  private seq = 0;
  private prev = GENESIS;
  private sink: (row: AuditRecord) => void;
  private algo: AuditAlgo;
  private hmacKey: string | null;

  constructor(runId: string, sink: (row: AuditRecord) => void = () => {}) {
    this.runId = runId;
    this.sink = sink;
    const { algo, hmacKey } = resolveAlgo();
    this.algo = algo;
    this.hmacKey = hmacKey;
  }

  emit(event: AuditEventName, opts: AuditEmitOptions = {}): AuditRecord {
    const replica = (opts.replica ?? "-") as string;
    const decision = (opts.decision ?? "-") as string;
    const reason = opts.reason ?? "-";
    const policy = opts.policy ?? "-";
    if (!EVENTS.has(event)) throw new Error(`unknown event: ${event}`);
    if (!REPLICAS.has(replica)) throw new Error("replica not in the allowed set");
    if (!DECISIONS.has(decision)) throw new Error("decision not in the allowed set");
    if (!REASON_RE.test(reason) || reason.length > 120) {
      throw new Error("reason must be enumerated codes joined by '+'");
    }
    if (!POLICY_RE.test(policy)) throw new Error("policy must be '-' or 12 hex characters");

    this.seq += 1;
    const body: Record<string, unknown> = {
      seq: this.seq,
      ts: new Date().toISOString(),
      run_id: this.runId,
      event,
      replica,
      decision,
      reason,
      policy,
    };
    const hash =
      this.algo === "v2-hmac-sha256" && this.hmacKey
        ? chainHmac(this.hmacKey, this.prev, body)
        : chainHash(this.prev, body);
    const record: AuditRecord = {
      seq: this.seq,
      ts: body.ts as string,
      runId: this.runId,
      event,
      replica: replica as AuditRecord["replica"],
      decision: decision as AuditDecision,
      reason,
      policy,
      prev: this.prev,
      hash,
      algo: this.algo,
    };
    this.rows.push(record);
    this.prev = hash;
    this.sink(record);
    return record;
  }

  get records(): readonly AuditRecord[] {
    return this.rows;
  }

  last(n: number): AuditRecord[] {
    return this.rows.slice(-n);
  }
}

/**
 * Verifies seq continuity, prev links and hashes.
 * Auto-detects algorithm per record: records with algo="v2-hmac-sha256" are
 * verified with HMAC-SHA-256 (requires AUDIT_HMAC_KEY env); all others use plain SHA-256.
 * Historical v1 records remain verifiable without the HMAC key.
 */
export function verifyChain(
  rows: readonly AuditRecord[],
  hmacKey?: string,
): {
  ok: boolean;
  problemLine: number | null;
  message: string;
  count: number;
} {
  const resolvedKey = hmacKey ?? process.env.AUDIT_HMAC_KEY ?? null;
  let prev = GENESIS;
  let expected = 1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    if (r.seq !== expected) return { ok: false, problemLine: line, message: "sequence gap", count: rows.length };
    if (r.prev !== prev) return { ok: false, problemLine: line, message: "broken link", count: rows.length };
    const rawTs = (r as { ts: unknown }).ts;
    const ts = rawTs instanceof Date ? rawTs.toISOString() : String(rawTs);
    const body: Record<string, unknown> = {
      seq: r.seq,
      ts,
      run_id: r.runId,
      event: r.event,
      replica: r.replica,
      decision: r.decision,
      reason: r.reason,
      policy: r.policy,
    };
    const recordAlgo = (r as { algo?: string }).algo ?? "v1-sha256";
    const expectedHash =
      recordAlgo === "v2-hmac-sha256" && resolvedKey
        ? chainHmac(resolvedKey, prev, body)
        : chainHash(prev, body);
    if (expectedHash !== r.hash) {
      return { ok: false, problemLine: line, message: "hash mismatch", count: rows.length };
    }
    prev = r.hash;
    expected += 1;
  }
  return { ok: true, problemLine: null, message: "ok", count: rows.length };
}
