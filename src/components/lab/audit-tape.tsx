"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/lab-api";
import { useLabStore } from "@/store/lab-store";
import { cn } from "@/lib/utils";
import type { AuditRecord } from "@/lib/lab-types";

/**
 * Audit tape — the hash-chained event stream, newest first, with a chain
 * verifier. Hover pauses the auto-scroll stickiness (feed keeps updating).
 */

const EVENT_CLASS: Record<string, string> = {
  controller_started: "text-foreground",
  policy_loaded: "text-foreground",
  policy_load_failed: "text-signal-red",
  health_changed: "text-muted-foreground",
  failure_detected: "text-signal-red font-bold",
  policy_evaluated: "text-foreground font-bold",
  failover_done: "text-signal-green font-bold",
  failover_refused: "text-signal-red font-bold",
  service_unavailable: "text-signal-red font-bold",
  service_restored: "text-signal-green font-bold",
  admin_switch_requested: "text-muted-foreground",
  fault_injected: "text-caution font-bold",
  fault_cleared: "text-caution",
};

function decisionClass(d: string): string {
  if (d === "PASS" || d === "SWITCHED" || d === "UP" || d === "HEALTHY") return "text-signal-green";
  if (d === "FAIL" || d === "REFUSED" || d === "DOWN" || d === "UNHEALTHY") return "text-signal-red";
  return "text-muted-foreground";
}

export function AuditTape() {
  const feed = useLabStore((s) => s.auditFeed);
  const runId = useLabStore((s) => s.runId);
  const [verifying, setVerifying] = useState(false);
  const [lastVerify, setLastVerify] = useState<string | null>(null);

  const rows = useMemo(() => feed.slice(0, 80), [feed]);

  const verify = async () => {
    setVerifying(true);
    try {
      const res = await api.verifyChain(runId);
      setLastVerify(res.message);
      if (res.ok) {
        toast.success("Audit chain verified", { description: `${res.count} events, links intact` });
      } else {
        toast.error("Audit chain BROKEN", { description: `line ${res.problemLine}: ${res.message}` });
      }
    } catch (err) {
      toast.error("Verify failed", { description: (err as Error).message });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <section className="panel min-w-0 p-4" aria-label="Audit tape">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-bold tracking-wide">Audit tape</h2>
          <span className="telemetry text-[11px] text-muted-foreground">run {runId}</span>
          {lastVerify && (
            <span className={cn("telemetry text-[11px] font-bold", lastVerify === "ok" ? "text-signal-green" : "text-signal-red")}>
              chain: {lastVerify}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={verify}
          disabled={verifying}
          className="min-h-9 border-1.5 border-foreground bg-card px-3 text-xs font-bold hover:bg-muted disabled:opacity-50"
        >
          {verifying ? "Verifying…" : "Verify chain"}
        </button>
      </div>

      <div className="mt-2 max-h-72 overflow-auto tape-scroll border-t border-border" role="log" aria-live="polite">
        <table className="w-full min-w-[34rem] border-collapse telemetry text-[11px]">
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="py-6 text-center text-muted-foreground" colSpan={5}>
                  no events yet — the controller writes them as things happen
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.seq}-${r.hash.slice(0, 6)}`} className="border-b border-border/60 last:border-0">
                <td className="w-10 py-1 pr-1 text-right text-muted-foreground">{r.seq}</td>
                <td className="w-28 py-1 pr-2 whitespace-nowrap text-muted-foreground">{r.ts.slice(11, 23)}</td>
                <td className={cn("w-44 py-1 pr-2 whitespace-nowrap", EVENT_CLASS[r.event] ?? "")}>{r.event}</td>
                <td className="w-8 py-1 pr-2">{r.replica}</td>
                <td className={cn("w-16 py-1 pr-2 font-bold", decisionClass(r.decision))}>{r.decision}</td>
                <td className="py-1 font-semibold">
                  {r.reason !== "-" ? (
                    <span className={cn(r.event === "policy_evaluated" && r.decision === "FAIL" ? "text-signal-red" : r.decision === "PASS" || r.decision === "SWITCHED" ? "text-signal-green" : "text-foreground")}>
                      {r.reason}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="plate mt-2">
        one hash-chained line per event · hash = sha256(prev ‖ body) · allow-listed fields only, no client data
      </p>
    </section>
  );
}

export type { AuditRecord };
