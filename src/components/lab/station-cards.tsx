"use client";

import { cn } from "@/lib/utils";
import { useLabStore } from "@/store/lab-store";
import type { ReplicaView } from "@/lib/lab-types";
import { PROFILE_LABEL } from "@/lib/lab-types";

/** Controller + replica station panels. */

function Row({ k, v, vClass }: { k: string; v: React.ReactNode; vClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-[11px] text-muted-foreground">{k}</span>
      <span className={cn("telemetry text-[11px] font-semibold", vClass)}>{v}</span>
    </div>
  );
}

export function ControllerCard() {
  const mode = useLabStore((s) => s.mode);
  const active = useLabStore((s) => s.active);
  const epoch = useLabStore((s) => s.epoch);
  const runId = useLabStore((s) => s.runId);
  const policy = useLabStore((s) => s.policy);
  const c = useLabStore((s) => s.controller);
  const ready = useLabStore((s) => s.ready);

  if (!ready) {
    return <div className="panel min-h-48 animate-pulse" aria-hidden />;
  }

  return (
    <article className="panel min-w-0 p-4" aria-label="Controller panel">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold tracking-wide">Controller</h2>
        <span className="plate">single writer · epoch on switch</span>
      </div>
      <div className="mt-2 border-t border-border pt-2">
        <Row k="mode" v={mode} vClass={mode === "SERVING" ? "text-signal-green" : mode === "UNAVAILABLE" ? "text-signal-red" : ""} />
        <Row k="active route" v={active ?? "—"} vClass={active ? "" : "text-signal-red"} />
        <Row k="epoch" v={epoch} />
        <Row k="run id" v={runId} />
      </div>
      <div className="mt-2 border-t border-border pt-2">
        <Row k="policy" v={policy ? `${policy.id} · ${policy.sha}` : "—"} />
        <Row k="allowed locations" v={policy ? policy.allowedLocations.join(" ") : "—"} />
        <Row k="TLS minimum" v={policy ? `${policy.minVersion} (${policy.enforcement})` : "—"} />
        <Row k="label ⇔ cert must match" v={policy?.requireCertLabelMatch ? "enforced (R4)" : "off"} />
        <Row k="replica must log minimal" v={policy?.requireMinimalLogging ? "enforced (R6)" : "off"} />
      </div>
      <div className="mt-2 border-t border-border pt-2">
        <Row k="health interval" v={`${c.healthIntervalMs ?? "—"} ms`} />
        <Row k="thresholds" v={`fail ${c.failureThreshold ?? "—"} · recover ${c.recoveryThreshold ?? "—"}`} />
        <Row k="overload limit" v={`${c.latencyThresholdMs ?? "—"} ms`} />
        <Row k="probe interval" v={`${c.probeIntervalMs ?? "—"} ms run · ${c.idleProbeIntervalMs ?? "—"} ms idle`} />
      </div>
    </article>
  );
}

const HEALTH_CLASS: Record<string, string> = {
  HEALTHY: "lamp-green",
  UNHEALTHY: "lamp-red",
  UNKNOWN: "lamp-off",
};

export function ReplicaCard({ r }: { r: ReplicaView }) {
  const activeReplica = useLabStore((s) => s.active);
  const isActive = activeReplica === r.id;
  const decision = r.lastDecision;

  return (
    <article
      className={cn("panel relative min-w-0 p-4", isActive && "outline outline-2 outline-foreground outline-offset-[3px]")}
      aria-label={`Replica ${r.id} station`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className={cn("lamp", HEALTH_CLASS[r.health], r.health === "HEALTHY" && isActive && "lamp-pulse")}
            role="img"
            aria-label={`health ${r.health}`}
          />
          <h2 className="text-sm font-bold tracking-wide">
            Replica {r.id}
            <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
              {PROFILE_LABEL[r.profile] ?? r.profile}
            </span>
          </h2>
        </div>
        {isActive ? (
          <span className="telemetry bg-foreground px-1.5 py-0.5 text-[10px] font-bold uppercase text-background">
            on route
          </span>
        ) : (
          <span className="telemetry border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
            standby
          </span>
        )}
      </div>

      <div className="mt-2 border-t border-border pt-2">
        <Row k="declared location" v={r.location} vClass={r.location !== r.certLocation ? "text-signal-red" : ""} />
        <Row k="certificate label" v={r.certLocation} vClass={r.location !== r.certLocation ? "text-signal-red" : ""} />
        <Row k="TLS range" v={`${r.tlsMin} – ${r.tlsMax}`} vClass={r.tlsMax < "1.2" ? "text-signal-red" : ""} />
        <Row k="logging claim" v={r.loggingClaim} vClass={r.loggingClaim !== "minimal" ? "text-signal-red" : ""} />
      </div>

      <div className="mt-2 border-t border-border pt-2">
        <Row
          k="health check"
          v={r.health === "HEALTHY" ? `ok · ${fmtMs(r.lastLatencyMs)}` : r.lastReason}
          vClass={r.health === "HEALTHY" ? "text-signal-green" : r.health === "UNHEALTHY" ? "text-signal-red" : ""}
        />
        <Row k="consecutive failures" v={r.consecutiveFails} />
        {r.fault && (
          <Row
            k="injected fault"
            v={r.fault.replace("_", " ")}
            vClass="text-signal-red font-bold"
          />
        )}
      </div>

      <div className="mt-2 border-t border-border pt-2">
        <span className="text-[11px] text-muted-foreground">last gate decision</span>
        {decision ? (
          <div
            className={cn(
              "mt-1 px-2 py-1 telemetry text-[11px] font-semibold",
              decision.passed ? "bg-signal-green-soft text-signal-green" : "bg-signal-red-soft text-signal-red",
            )}
          >
            {decision.passed ? "PASS" : `FAIL — ${decision.reasons.join(" + ")}`}
          </div>
        ) : (
          <div className="mt-1 px-2 py-1 telemetry text-[11px] text-muted-foreground border border-dashed border-border">
            not evaluated yet this run
          </div>
        )}
      </div>
    </article>
  );
}

function fmtMs(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)} ms`;
}
