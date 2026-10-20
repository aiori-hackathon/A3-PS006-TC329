"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type RunSummaryLike } from "@/lib/lab-api";
import { useLabStore } from "@/store/lab-store";
import { cn } from "@/lib/utils";
import type { ScenarioCard } from "@/lib/lab-types";

/** Section 2 — scenario runner S1–S9 and per-scenario aggregates. */

const SCENARIO_ORDER = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"];

const EXPECTED_REASONS: Record<string, string> = {
  S1: "—", S2: "—", S3: "R3 + R5", S4: "R5", S5: "R3", S6: "—", S7: "R4", S8: "R6", S9: "R5 → restored on A",
};

const FAULT_TEXT: Record<string, string> = {
  crash: "process crash",
  link_loss: "link loss",
  overload: "overload",
};

function fmt(v: number | null | undefined, unit = " ms", digits = 0): string {
  if (v == null) return "—";
  return `${v.toFixed(digits)}${unit}`;
}

export function ScenariosSection() {
  const scenarioStatus = useLabStore((s) => s.scenarioStatus);
  const [matrix, setMatrix] = useState<ScenarioCard[] | null>(null);
  const [runs, setRuns] = useState<RunSummaryLike[] | null>(null);
  const [picked, setPicked] = useState("S1");
  const [repeats, setRepeats] = useState(3);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [m, r] = await Promise.all([api.matrix(), api.runs(200)]);
      setMatrix(m.scenarios);
      setRuns(r.runs);
    } catch {
      /* retry on next section visit */
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Refresh when a batch finishes.
  const running = scenarioStatus?.running === true;
  useEffect(() => {
    if (!running) void load();
  }, [running]);

  const start = async () => {
    setBusy(true);
    try {
      await api.startScenario(picked, repeats);
      toast(`Batch ${picked} started`, { description: `${repeats} repeat(s) — manual controls are locked while it runs` });
    } catch (err) {
      toast.error("Could not start batch", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api.cancelScenario();
      toast("Cancel requested", { description: "stops after the current repeat; state is left clean" });
    } finally {
      setBusy(false);
    }
  };

  const cards = SCENARIO_ORDER.map(
    (key) => matrix?.find((s) => s.key === key) ?? ({
      key,
      title: "",
      fault: "",
      bProfile: "",
      expect: "",
      headline: false,
      runs: 0,
      passRate: null,
      downtime: { count: 0, mean: null, p50: null, p95: null, min: null, max: null },
      meanDetectMs: null,
      meanScore: null,
      bestGrade: null,
      violations: 0,
    }),
  );

  const status = scenarioStatus;

  return (
    <div className="grid gap-4">
      {/* Runner bar */}
      <section className="panel p-4" aria-label="Scenario runner">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="scenario" className="text-[11px] text-muted-foreground">
              scenario
            </label>
            <select
              id="scenario"
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              disabled={running}
              className="telemetry mt-1 h-10 min-w-44 border-1.5 border-foreground bg-card px-2 text-xs disabled:opacity-50"
            >
              {SCENARIO_ORDER.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="repeats" className="text-[11px] text-muted-foreground">
              repeats
            </label>
            <select
              id="repeats"
              value={repeats}
              onChange={(e) => setRepeats(Number(e.target.value))}
              disabled={running}
              className="telemetry mt-1 h-10 border-1.5 border-foreground bg-card px-2 text-xs disabled:opacity-50"
            >
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          {running ? (
            <button
              type="button"
              onClick={cancel}
              className="min-h-10 border-1.5 border-signal-red bg-signal-red-soft px-4 text-xs font-bold text-signal-red hover:bg-signal-red hover:text-white"
            >
              Cancel batch
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={busy}
              className="min-h-10 bg-foreground px-4 text-xs font-bold text-background hover:bg-ink-soft disabled:opacity-50"
            >
              {busy ? "Starting…" : "Start batch"}
            </button>
          )}

          {/* Live progress */}
          <div className="ml-auto min-w-56 flex-1">
            <div className="flex items-baseline justify-between">
              <span className="plate">
                {running ? `running ${status?.scenario} · repeat ${status?.repeat}/${status?.repeats} · ${status?.phase}` : "batch idle"}
              </span>
              {running && (
                <span className="telemetry text-[11px] font-bold">{Math.round((status?.progress ?? 0) * 100)}%</span>
              )}
            </div>
            <div className="mt-1.5 h-3 border-1.5 border-foreground bg-background" role="progressbar" aria-valuenow={Math.round((status?.progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="h-full bg-signal-green transition-all duration-500"
                style={{ width: `${Math.round((status?.progress ?? 0) * 100)}%` }}
              />
            </div>
            {status?.lastSummary && (
              <p className="telemetry mt-1 text-[10.5px] text-muted-foreground">
                last: {status.lastSummary.runId} → {status.lastSummary.outcome} ·{" "}
                {status.lastSummary.reasons !== "-" ? `${status.lastSummary.reasons} · ` : ""}
                downtime {fmt(status.lastSummary.downtimeMs, " ms", 0)} · score {status.lastSummary.scoreTotal}{" "}
                {status.lastSummary.grade}
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
          Each repeat: reset → 3 s warm-up → fault on A → observe 12 s → analyze → score. One run ≈ 18 s. S9
          restarts A at +6 s to prove recovery. The console keeps streaming while a batch runs.
        </p>
      </section>

      {/* Scenario cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((s) => {
          const spec = matrix?.find((m) => m.key === s.key);
          const recentForScenario = (runs ?? []).filter((r) => r.scenario === s.key).slice(0, 3);
          return (
            <article
              key={s.key}
              className={cn("panel p-4", s.headline && "outline outline-1 outline-foreground outline-offset-[3px]")}
              aria-label={`Scenario ${s.key}`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-bold">
                  {s.key}
                  {s.headline && <span className="plate ml-2">demo set</span>}
                </h3>
                <span
                  className={cn(
                    "telemetry border px-1.5 py-0.5 text-[10px] font-bold uppercase",
                    s.expect === "FAILOVER" || s.expect === "RESTORED"
                      ? "border-signal-green text-signal-green"
                      : "border-signal-red text-signal-red",
                  )}
                >
                  expect {s.expect.toLowerCase()}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {FAULT_TEXT[spec?.fault ?? ""] ?? ""} on A · B = <span className="telemetry">{spec?.bProfile ?? "—"}</span>
              </p>
              <p className="telemetry mt-1 text-[10.5px] text-muted-foreground">
                gate result: {EXPECTED_REASONS[s.key]}
              </p>

              <div className="mt-2 grid grid-cols-2 gap-x-4 border-t border-border pt-2 telemetry text-[11px]">
                <Stat k="runs" v={`${s.runs}`} />
                <Stat
                  k="pass rate"
                  v={s.passRate == null ? "—" : `${(s.passRate * 100).toFixed(0)}%`}
                  vClass={s.passRate != null && s.passRate < 1 ? "text-signal-red" : s.passRate === 1 ? "text-signal-green" : ""}
                />
                <Stat k="downtime mean" v={fmt(s.downtime.mean)} />
                <Stat k="p95" v={fmt(s.downtime.p95)} />
                <Stat k="min / max" v={`${fmt(s.downtime.min)} / ${fmt(s.downtime.max)}`} />
                <Stat k="mean detect" v={fmt(s.meanDetectMs)} />
                <Stat k="best grade" v={s.bestGrade ?? "—"} vClass={s.bestGrade === "A+" ? "text-signal-green" : ""} />
                <Stat
                  k="violations"
                  v={`${s.violations}`}
                  vClass={s.violations > 0 ? "text-signal-red font-bold" : "text-signal-green"}
                />
              </div>

              {recentForScenario.length > 0 && (
                <p className="telemetry mt-2 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
                  recent: {recentForScenario.map((r) => `${r.id.replace(/-[0-9a-f]+$/, "")} ${r.grade ?? "…"}`).join(" · ")}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ k, v, vClass }: { k: string; v: string; vClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("font-bold", vClass)}>{v}</span>
    </div>
  );
}
