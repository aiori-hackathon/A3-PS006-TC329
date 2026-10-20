"use client";

import { useMemo } from "react";
import { useLabStore } from "@/store/lab-store";
import { cn } from "@/lib/utils";
import type { Mode, ReplicaView } from "@/lib/lab-types";

/**
 * The signature element: a schematic route diagram in signal-box style.
 * PROBE ── CONTROLLER ── points ──▶ A (route set) / B (interlocked).
 * The active path is a flowing green stroke; a refused path carries a red
 * interlock cross and the exact reason codes; the state strip under it shows
 * where the controller state machine stands.
 */

const MODES: Mode[] = ["STARTING", "SERVING", "EVALUATING", "UNAVAILABLE"];

function replicaStatus(r: ReplicaView, isActive: boolean, mode: Mode): "serving" | "standby" | "refused" | "unhealthy" {
  if (isActive && mode === "SERVING") return "serving";
  if (r.lastDecision && !r.lastDecision.passed && (mode === "UNAVAILABLE" || mode === "EVALUATING")) return "refused";
  if (r.health === "UNHEALTHY") return "unhealthy";
  return "standby";
}

export function RouteDiagram() {
  const mode = useLabStore((s) => s.mode);
  const active = useLabStore((s) => s.active);
  const replicas = useLabStore((s) => s.replicas);
  const policy = useLabStore((s) => s.policy);
  const probeRing = useLabStore((s) => s.probeRing);
  const auditFeed = useLabStore((s) => s.auditFeed);

  const a = replicas.find((r) => r.id === "A");
  const b = replicas.find((r) => r.id === "B");

  const refusal = useMemo(() => {
    if (mode !== "UNAVAILABLE" && mode !== "EVALUATING") return null;
    const row = auditFeed.find((r) => r.event === "failover_refused");
    if (!row) return null;
    const target = row.replica === "A" ? a : b;
    return { reasons: row.reason === "-" ? [] : row.reason.split("+"), replica: row.replica, view: target };
  }, [mode, auditFeed, a, b]);

  const lastProbe = probeRing.length > 0 ? probeRing[probeRing.length - 1] : null;

  const nodeA = (r: ReplicaView | undefined, rid: "A" | "B", y: number) => {
    if (!r) return null;
    const isActive = active === rid;
    const status = replicaStatus(r, isActive, mode);
    const stroke =
      status === "serving" ? "var(--signal-green)" :
      status === "refused" ? "var(--signal-red)" :
      status === "unhealthy" ? "var(--caution)" : "var(--steel)";
    return (
      <g key={rid}>
        {/* path from points to station — both start at the Y junction (470,144) */}
        <path
          d={`M 470 144 L 560 ${y}`}
          fill="none"
          stroke={status === "serving" ? "var(--signal-green)" : "var(--steel)"}
          strokeWidth={status === "serving" ? 3.5 : 2}
          strokeDasharray={status === "serving" ? undefined : "5 5"}
          opacity={status === "serving" ? 1 : 0.5}
        />
        {status === "serving" && (
          <path
            d={`M 470 144 L 560 ${y}`}
            fill="none"
            stroke="var(--signal-green)"
            strokeWidth={3.5}
            className="route-flow route-flow-active"
          />
        )}
        {status === "refused" && (
          <g stroke="var(--signal-red)" strokeWidth={2.5}>
            <line x1={512} x2={524} y1={y === 84 ? 128 : 160} y2={y === 84 ? 116 : 172} />
            <line x1={512} x2={524} y1={y === 84 ? 116 : 172} y2={y === 84 ? 128 : 160} />
          </g>
        )}
        {/* station box */}
        <rect
          x={560}
          y={y - 26}
          width={200}
          height={52}
          rx={2}
          fill="var(--card)"
          stroke={stroke}
          strokeWidth={isActive || status === "refused" ? 2.5 : 1.5}
        />
        <text x={574} y={y - 8} fontFamily="var(--font-mono)" fontSize={11} fill="var(--muted-foreground)">
          REPLICA {rid} · {r.profile}
        </text>
        <text x={574} y={y + 9} fontFamily="var(--font-mono)" fontSize={12} fontWeight={700} fill="var(--foreground)">
          {r.location}
          {" · TLS "}
          {r.tlsMin === r.tlsMax ? r.tlsMax : `${r.tlsMin}–${r.tlsMax}`}
          {" · "}
          {r.loggingClaim}
        </text>
        <circle cx={742} cy={y - 12} r={5} className={cn("lamp",
          r.health === "HEALTHY" ? "lamp-green" : r.health === "UNHEALTHY" ? "lamp-red" : "lamp-off")} />
        {isActive && (
          <rect x={560} y={y + 14} width={64} height={12} fill="var(--foreground)" />
        )}
        {isActive && (
          <text x={567} y={y + 23.5} fontSize={8.5} fontFamily="var(--font-mono)" fill="var(--card)" fontWeight={700}>
            ACTIVE
          </text>
        )}
        {r.fault && (
          <text x={706} y={y + 24} fontSize={9} fontFamily="var(--font-mono)" fill="var(--signal-red)" fontWeight={700}>
            ⚠ {r.fault}
          </text>
        )}
      </g>
    );
  };

  return (
    <section aria-label="Live traffic route" className="panel min-w-0 p-4 sm:p-5">
      <svg
        viewBox="0 0 800 252"
        className="w-full max-w-full"
        role="img"
        aria-label={`Route: probe to controller${active ? `, currently serving replica ${active}` : ", no compliant replica"}`}
      >
        {/* probe / clients */}
        <rect x={18} y={94} width={132} height={32} rx={2} fill="var(--card)" stroke="var(--foreground)" strokeWidth={1.5} />
        <text x={32} y={114} fontFamily="var(--font-mono)" fontSize={12} fontWeight={700} fill="var(--foreground)">
          PROBE
        </text>
        <text x={168} y={106} fontFamily="var(--font-mono)" fontSize={9.5} fill="var(--muted-foreground)">
          {probeRing.length > 0 ? `last #${lastProbe?.seq} → ${lastProbe?.status ?? "—"}` : "waiting"}
        </text>
        <path
          d="M 150 110 L 262 110"
          stroke={active ? "var(--signal-green)" : "var(--signal-red)"}
          strokeWidth={3}
          fill="none"
          opacity={0.9}
          className={cn(active && "route-flow route-flow-active")}
        />
        {mode === "UNAVAILABLE" && (
          <g stroke="var(--signal-red)" strokeWidth={2.5}>
            <line x1={206} x2={218} y1={99} y2={121} />
            <line x1={206} x2={218} y1={121} y2={99} />
          </g>
        )}

        {/* controller / interlocking */}
        <rect x={262} y={76} width={208} height={68} rx={2} fill="var(--card)" stroke="var(--foreground)" strokeWidth={2.5} />
        <text x={278} y={97} fontFamily="var(--font-mono)" fontSize={12} fontWeight={700} fill="var(--foreground)">
          CONTROLLER
        </text>
        <text x={278} y={113} fontFamily="var(--font-mono)" fontSize={9.5} fill="var(--muted-foreground)">
          interlocked gate · {policy ? policy.sha : "…"}
        </text>
        <text x={278} y={129} fontFamily="var(--font-mono)" fontSize={9.5} fill="var(--muted-foreground)">
          no PASS, no route change
        </text>

        {/* points (switch) to the two stations */}
        <path d="M 470 110 L 470 144" stroke="var(--foreground)" strokeWidth={1.5} fill="none" />
        <path d="M 458 110 L 482 110" stroke="var(--foreground)" strokeWidth={1.5} />
        <text x={482} y={152} fontFamily="var(--font-mono)" fontSize={8} fill="var(--muted-foreground)">
          points
        </text>

        {nodeA(a, "A", 84)}
        {nodeA(b, "B", 178)}

        {/* refusal annotation */}
        {refusal && (
          <g>
            <rect
              x={560}
              y={refusal.replica === "B" ? 204 : 110}
              width={204}
              height={40}
              fill="var(--signal-red-soft)"
              stroke="var(--signal-red)"
              strokeWidth={1.5}
            />
            <text x={570} y={refusal.replica === "B" ? 221 : 127} fontFamily="var(--font-mono)" fontSize={9.5} fontWeight={700} fill="var(--signal-red)">
              INTERLOCK: route to {refusal.replica} refused
            </text>
            <text x={570} y={refusal.replica === "B" ? 236 : 142} fontFamily="var(--font-mono)" fontSize={9.5} fill="var(--signal-red)">
              {refusal.reasons.join(" + ")}
            </text>
          </g>
        )}

        {/* fail-closed annotation when nothing is served */}
        {mode === "UNAVAILABLE" && (
          <text x={278} y={166} fontFamily="var(--font-mono)" fontSize={10} fontWeight={700} fill="var(--signal-red)">
            503 no_compliant_replica — fail closed
          </text>
        )}
      </svg>

      {/* state machine strip */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="plate mr-1">state</span>
        {MODES.map((m) => (
          <span
            key={m}
            className={cn(
              "telemetry px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              mode === m
                ? m === "SERVING"
                  ? "bg-signal-green text-white"
                  : m === "UNAVAILABLE"
                    ? "bg-signal-red text-white lamp-pulse"
                    : m === "EVALUATING"
                      ? "bg-caution text-white"
                      : "bg-foreground text-background"
                : "border border-border text-muted-foreground",
            )}
            aria-current={mode === m ? "true" : undefined}
          >
            {m}
          </span>
        ))}
      </div>
    </section>
  );
}
