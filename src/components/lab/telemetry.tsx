"use client";

import { useMemo, useState } from "react";
import { useLabStore } from "@/store/lab-store";
import { cn } from "@/lib/utils";

/**
 * Probe strip chart — a seismograph of the client's view: one tick per probe,
 * height = latency for successes (green), full-height red marks for failures.
 * Plus the live outage readout and ok-rate.
 */

const WINDOW = 160;

export function Telemetry() {
  const probeRing = useLabStore((s) => s.probeRing);
  const ready = useLabStore((s) => s.ready);
  const mode = useLabStore((s) => s.mode);
  const [hoverSeq, setHoverSeq] = useState<number | null>(null);

  const window0 = useMemo(() => probeRing.slice(-WINDOW), [probeRing]);

  const stats = useMemo(() => {
    if (window0.length === 0) return null;
    const ok = window0.filter((p) => p.ok).length;
    const lat = window0.filter((p) => p.ok && p.latencyMs != null).map((p) => p.latencyMs!);
    const latMax = lat.length > 0 ? Math.max(...lat, 5) : 5;

    // live outage: last streak of failures, and whether it is still open
    let streakStart = -1;
    for (let i = window0.length - 1; i >= 0; i--) {
      if (!window0[i].ok) streakStart = i;
      else break;
    }
    const openNow = streakStart >= 0 && mode !== "SERVING";
    let downtimeMs: number | null = null;
    if (streakStart >= 0) {
      const startNs = window0[streakStart].tSendNs;
      const endNs = openNow ? window0[window0.length - 1].tSendNs : window0[window0.length - 1].tSendNs;
      if (openNow || mode !== "SERVING") {
        downtimeMs = (endNs - startNs) / 1e6;
      } else {
        // closed outage: last fail streak that has recovered
        let j = streakStart;
        while (j >= 0 && !window0[j].ok) j--;
        if (j >= 0) downtimeMs = (window0[streakStart].tSendNs - window0[j].tSendNs) / 1e6;
      }
    }
    return {
      okRate: ok / window0.length,
      latMax,
      downtimeMs,
      openNow,
      hover: hoverSeq != null ? window0.find((p) => p.seq === hoverSeq) ?? null : window0[window0.length - 1],
    };
  }, [window0, hoverSeq, mode]);

  const H = 64;
  const W = 1000;
  const bw = W / WINDOW;

  return (
    <section className="panel min-w-0 p-4" aria-label="Probe telemetry">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <h2 className="text-sm font-bold tracking-wide">Probe telemetry</h2>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 telemetry text-[11px]">
          <span className="text-muted-foreground">
            last probe{" "}
            <span className={cn("font-bold", stats?.hover?.ok ? "text-signal-green" : stats?.hover && "text-signal-red")}>
              {stats?.hover ? (stats.hover.ok ? "200 OK" : `${stats.hover.status ?? "err"} ${stats.hover.error ?? ""}`) : "—"}
            </span>
            {stats?.hover?.servedBy && <span className="text-muted-foreground"> by {stats.hover.servedBy}</span>}
          </span>
          <span className="text-muted-foreground">
            ok rate <span className={cn("font-bold", (stats?.okRate ?? 1) >= 0.99 ? "text-signal-green" : "text-signal-red")}>{stats ? (stats.okRate * 100).toFixed(0) : "—"}%</span>
          </span>
          <span className="text-muted-foreground">
            outage{" "}
            <span className={cn("font-bold", stats?.downtimeMs != null ? (stats.openNow ? "text-signal-red" : "text-foreground") : "text-muted-foreground")}>
              {stats?.downtimeMs != null ? `${Math.round(stats.downtimeMs)} ms${stats.openNow ? " (open)" : ""}` : "—"}
            </span>
          </span>
          <span className="hidden text-muted-foreground sm:inline">resolution ± probe interval</span>
        </div>
      </div>

      <div className="relative mt-2">
        {!ready ? (
          <div className="h-16 animate-pulse border border-dashed border-border" aria-hidden />
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-16 w-full border-b border-border"
            role="img"
            aria-label="Rolling strip chart of probe results"
            onMouseLeave={() => setHoverSeq(null)}
          >
            {window0.map((p, i) => {
              const x = i * bw;
              if (p.ok) {
                const frac = Math.min(1, (p.latencyMs ?? 2) / (stats?.latMax ?? 20));
                const h = Math.max(3, frac * (H - 10));
                return (
                  <rect
                    key={p.seq}
                    x={x + 0.5}
                    y={H - h}
                    width={Math.max(2, bw - 1.5)}
                    height={h}
                    fill="var(--signal-green)"
                    opacity={0.85}
                    onMouseEnter={() => setHoverSeq(p.seq)}
                  />
                );
              }
              return (
                <rect
                  key={p.seq}
                  x={x + 0.5}
                  y={0}
                  width={Math.max(2, bw - 1.5)}
                  height={H}
                  fill={p.status === 503 ? "var(--caution)" : "var(--signal-red)"}
                  opacity={0.9}
                  onMouseEnter={() => setHoverSeq(p.seq)}
                />
              );
            })}
            {window0.length === 0 && (
              <text x={8} y={36} fontFamily="var(--font-mono)" fontSize={12} fill="var(--muted-foreground)">
                waiting for probe data…
              </text>
            )}
          </svg>
        )}
        <p className="plate mt-1.5">
          green tick height = latency · red = 502 upstream failure · amber = 503 fail closed · hover a tick for details
        </p>
      </div>
    </section>
  );
}
