"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type RunDetail, type RunSummaryLike } from "@/lib/lab-api";
import { cn } from "@/lib/utils";

/** Section 4 — Records: run history, run detail sheet (timeline, probe, score, audit). */

const fmtMs = (v: number | null | undefined, digits = 0): string =>
  v == null ? "—" : `${v.toFixed(digits)} ms`;

const GRADE_CLASS: Record<string, string> = {
  "A+": "bg-signal-green text-white",
  A: "bg-signal-green-soft text-signal-green",
  B: "bg-caution-soft text-caution",
  C: "bg-caution-soft text-caution",
  D: "bg-signal-red text-white",
};

export function RecordsSection() {
  const [runs, setRuns] = useState<RunSummaryLike[] | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.runs(120);
      setRuns(res.runs);
    } catch (err) {
      toast.error("Could not load runs", { description: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (runId: string) => {
    setLoading(true);
    try {
      setDetail(await api.runDetail(runId));
    } catch (err) {
      toast.error("Could not load run", { description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-4">
      <section className="panel p-4" aria-label="Run history">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-wide">Scenario runs</h2>
          <span className="plate">evidence per run · downtime resolution ±50 ms</span>
        </div>

        <div className="mt-2 max-h-[26rem] overflow-auto tape-scroll border-t border-border">
          <table className="w-full min-w-[52rem] border-collapse telemetry text-[11px]">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b-2 border-foreground text-left">
                <th className="py-1.5 pr-3 font-bold">run</th>
                <th className="py-1.5 pr-3 font-bold">expected</th>
                <th className="py-1.5 pr-3 font-bold">outcome</th>
                <th className="py-1.5 pr-3 font-bold">reason codes</th>
                <th className="py-1.5 pr-3 font-bold">downtime</th>
                <th className="py-1.5 pr-3 font-bold">detect</th>
                <th className="py-1.5 pr-3 font-bold">decide</th>
                <th className="py-1.5 pr-3 font-bold">switch</th>
                <th className="py-1.5 pr-3 font-bold">chain</th>
                <th className="py-1.5 pr-3 font-bold">invariant</th>
                <th className="py-1.5 pr-3 font-bold">score</th>
              </tr>
            </thead>
            <tbody>
              {(runs ?? []).length === 0 && (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-muted-foreground">
                    No runs recorded yet. Start a scenario from the Scenarios panel.
                  </td>
                </tr>
              )}
              {(runs ?? []).map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-border/60 hover:bg-muted/60 last:border-0"
                  onClick={() => void open(r.id)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && void open(r.id)}
                  aria-label={`Open run ${r.id}`}
                >
                  <td className="py-1.5 pr-3 font-bold">{r.id}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{r.expect}</td>
                  <td
                    className={cn(
                      "py-1.5 pr-3 font-bold",
                      r.outcome === r.expect ? "text-signal-green" : "text-signal-red",
                    )}
                  >
                    {r.outcome ?? "…"}
                  </td>
                  <td className={cn("py-1.5 pr-3", r.reasons !== "-" && r.reasons ? "text-signal-red font-semibold" : "text-muted-foreground")}>
                    {r.reasons === "-" || !r.reasons ? "—" : r.reasons}
                  </td>
                  <td className="py-1.5 pr-3">
                    {r.downtimeMs == null ? "—" : `${Math.round(r.downtimeMs)} ms`}
                    {r.outageOpen ? "*" : ""}
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{fmtMs(r.detectMs)}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{fmtMs(r.decideMs)}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{fmtMs(r.switchMs)}</td>
                  <td className="py-1.5 pr-3">
                    <span className={r.auditChainOk ? "text-signal-green font-bold" : "text-signal-red font-bold"}>
                      {r.auditChainOk ? "✓" : "✗"}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className={r.servedByNoncompliant === 0 ? "text-signal-green font-bold" : "text-signal-red font-bold"}>
                      {r.servedByNoncompliant ?? "—"}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className={cn("px-1.5 py-0.5 font-bold", GRADE_CLASS[r.grade ?? "D"])}>
                      {r.grade ?? "…"} {r.scoreTotal != null ? `· ${Math.round(r.scoreTotal)}` : ""}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="plate mt-2">* outage still open at the end of the window (expected for refusal scenarios)</p>
      </section>

      {detail && (
        <RunDetailSheet
          detail={detail}
          loading={loading}
          onClose={() => setDetail(null)}
          onRefresh={() => void open(detail.run.id)}
        />
      )}
    </div>
  );
}

function RunDetailSheet({
  detail,
  loading,
  onClose,
  onRefresh,
}: {
  detail: RunDetail;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [verify, setVerify] = useState<{ ok: boolean; message: string; problemLine: number | null } | null>(null);
  const [tampered, setTampered] = useState<{ seq: number; from: string; to: string; event: string } | null>(null);
  const [tamperBusy, setTamperBusy] = useState(false);
  const run = detail.run;

  const doVerify = async () => {
    try {
      const res = await api.verifyChain(run.id);
      setVerify(res);
    } catch (err) {
      toast.error("Verify failed", { description: (err as Error).message });
    }
  };

  const doTamper = async () => {
    setTamperBusy(true);
    try {
      const res = await api.tamperChain(run.id);
      setTampered({ seq: res.seq, from: res.from, to: res.to, event: res.event });
      toast("Audit row rewritten", {
        description: `Row ${res.seq} (${res.event}) now says ${res.to} instead of ${res.from}. Verify the chain to see if it notices.`,
      });
      onRefresh();
      await doVerify();
    } catch (err) {
      toast.error("Could not rewrite the row", { description: (err as Error).message });
    } finally {
      setTamperBusy(false);
    }
  };

  const doRestore = async () => {
    setTamperBusy(true);
    try {
      const res = await api.restoreChain();
      setTampered(null);
      toast("Original row written back", {
        description: `Row ${res.seq} restored. Verify the chain again — it should pass.`,
      });
      onRefresh();
      await doVerify();
    } catch (err) {
      toast.error("Could not restore the row", { description: (err as Error).message });
    } finally {
      setTamperBusy(false);
    }
  };

  const faultIdx = detail.timeline.findIndex((t) => t.event === "fault_injected");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/40" role="dialog" aria-modal="true" aria-label={`Run ${run.id} detail`}>
      <div className="h-full w-full max-w-3xl overflow-y-auto tape-scroll bg-background border-l-2 border-foreground shadow-none">
        {/* Sheet header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b-2 border-foreground bg-card px-4 py-3">
          <div>
            <h2 className="text-sm font-bold tracking-wide">{run.id}</h2>
            <p className="telemetry text-[11px] text-muted-foreground">
              {run.scenario} · fault {run.fault} · B = {run.bProfile} · expected {run.expect}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {loading && <span className="telemetry text-[11px] text-muted-foreground">loading…</span>}
            <span className={cn("telemetry px-2 py-1 text-xs font-bold", GRADE_CLASS[run.grade ?? "D"])}>
              {run.grade} · {run.scoreTotal != null ? Math.round(run.scoreTotal) : "…"}/100
            </span>
            <button
              type="button"
              onClick={onClose}
              className="min-h-9 border-1.5 border-foreground bg-card px-3 text-xs font-bold hover:bg-muted"
              aria-label="Close run detail"
            >
              Close
            </button>
          </div>
        </div>

        <div className="grid gap-4 p-4">
          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Head k="outcome" v={run.outcome ?? "…"} cls={run.outcome === run.expect ? "text-signal-green" : "text-signal-red"} />
            <Head k="downtime" v={run.downtimeMs == null ? "—" : `${Math.round(run.downtimeMs)} ms${run.outageOpen ? " (open)" : ""}`} />
            <Head k="detect → decide" v={`${fmtMs(run.detectMs)} → ${fmtMs(run.decideMs)}`} />
            <Head k="switch" v={fmtMs(run.switchMs)} />
          </div>

          {/* Score breakdown */}
          <section className="panel p-3" aria-label="Score breakdown">
            <h3 className="text-xs font-bold tracking-wide">Score breakdown</h3>
            <div className="mt-2 grid gap-1.5">
              {detail.score.components.map((c) => (
                <div key={c.key} className="flex items-center gap-2">
                  <span className="telemetry w-7 text-[10px] font-bold text-muted-foreground">{c.key}</span>
                  <span className="w-36 text-[11px] font-semibold">{c.label}</span>
                  <div className="h-2.5 flex-1 border border-foreground bg-background">
                    <div
                      className={cn("h-full", c.points === c.maxPoints ? "bg-signal-green" : c.points === 0 ? "bg-signal-red" : "bg-caution")}
                      style={{ width: `${(c.points / c.maxPoints) * 100}%` }}
                    />
                  </div>
                  <span className="telemetry w-14 text-right text-[11px] font-bold">
                    {c.points}/{c.maxPoints}
                  </span>
                  <span className="telemetry hidden w-64 text-[10px] text-muted-foreground md:block">{c.note}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Timeline */}
          <section className="panel p-3" aria-label="Event timeline">
            <h3 className="text-xs font-bold tracking-wide">Timeline — offsets from the fault</h3>
            <div className="mt-2 max-h-64 overflow-y-auto tape-scroll telemetry text-[11px]">
              <table className="w-full border-collapse">
                <tbody>
                  {detail.timeline.map((t, i) => (
                    <tr
                      key={i}
                      className={cn(
                        "border-b border-border/60 last:border-0",
                        t.event.startsWith("failover") || t.event === "service_restored" || t.event === "service_unavailable"
                          ? "font-bold"
                          : "",
                        i === faultIdx && "bg-caution-soft",
                      )}
                    >
                      <td
                        className={cn("w-20 py-0.5 pr-2 text-right font-bold", t.offsetMs >= 0 ? "text-foreground" : "text-muted-foreground")}
                      >
                        {t.offsetMs >= 0 ? "+" : "−"}
                        {(Math.abs(t.offsetMs) / 1000).toFixed(3)}s
                      </td>
                      <td className="w-44 py-0.5 pr-2">{t.event}</td>
                      <td className="w-8 py-0.5 pr-2">{t.replica}</td>
                      <td
                        className={cn(
                          "w-16 py-0.5 pr-2 font-bold",
                          t.decision === "PASS" || t.decision === "SWITCHED" || t.decision === "UP"
                            ? "text-signal-green"
                            : t.decision === "FAIL" || t.decision === "REFUSED" || t.decision === "DOWN"
                              ? "text-signal-red"
                              : "text-muted-foreground",
                        )}
                      >
                        {t.decision}
                      </td>
                      <td className={cn("py-0.5", t.reason !== "-" ? "font-semibold" : "text-muted-foreground")}>{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Probe chart */}
          <section className="panel p-3" aria-label="Probe chart">
            <h3 className="text-xs font-bold tracking-wide">Probe — the client's view</h3>
            <ProbeChart detail={detail} />
          </section>

          {/* Audit rows + verify */}
          <section className="panel p-3" aria-label="Audit evidence">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold tracking-wide">Audit evidence ({detail.audit.length} rows)</h3>
              <div className="flex flex-wrap items-center gap-2">
                {verify && (
                  <span
                    className={cn(
                      "telemetry px-1.5 py-0.5 text-[11px] font-bold",
                      verify.ok ? "bg-signal-green-soft text-signal-green" : "bg-signal-red-soft text-signal-red",
                    )}
                    role="status"
                  >
                    chain: {verify.message}
                    {!verify.ok && verify.problemLine != null && ` · line ${verify.problemLine}`}
                  </span>
                )}
                <button
                  type="button"
                  onClick={doVerify}
                  className="min-h-8 border-1.5 border-foreground bg-card px-2.5 text-[11px] font-bold hover:bg-muted"
                >
                  Verify chain
                </button>
                {tampered ? (
                  <button
                    type="button"
                    onClick={() => void doRestore()}
                    disabled={tamperBusy}
                    className="min-h-8 border-1.5 border-signal-green bg-card px-2.5 text-[11px] font-bold text-signal-green hover:bg-signal-green-soft disabled:opacity-50"
                  >
                    Restore original
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void doTamper()}
                    disabled={tamperBusy}
                    className="min-h-8 border-1.5 border-signal-red bg-card px-2.5 text-[11px] font-bold text-signal-red hover:bg-signal-red-soft disabled:opacity-50"
                    aria-label="Rewrite one audit row to demonstrate tamper detection"
                  >
                    Rewrite a row
                  </button>
                )}
              </div>
            </div>
            <p className="plate mt-1">
              every row is sealed with SHA-256 over the previous hash — rewrite any field and the seal breaks at that line
            </p>
            <div className="mt-2 max-h-56 overflow-y-auto tape-scroll telemetry text-[10.5px]">
              <table className="w-full border-collapse">
                <tbody>
                  {detail.audit.map((r) => (
                    <tr
                      key={r.seq}
                      className={cn(
                        "border-b border-border/60 last:border-0",
                        tampered?.seq === r.seq && "bg-signal-red-soft",
                      )}
                    >
                      <td className="w-8 py-0.5 pr-2 text-right text-muted-foreground">{r.seq}</td>
                      <td className="w-24 py-0.5 pr-2 text-muted-foreground">{r.ts.slice(11, 23)}</td>
                      <td className="w-40 py-0.5 pr-2">{r.event}</td>
                      <td className="w-6 py-0.5 pr-2">{r.replica}</td>
                      <td
                        className={cn(
                          "w-16 py-0.5 pr-2 font-bold",
                          tampered?.seq === r.seq && "text-signal-red",
                        )}
                      >
                        {r.decision}
                      </td>
                      <td className="py-0.5">{r.reason}</td>
                      <td
                        className={cn(
                          "w-24 py-0.5 text-right text-muted-foreground",
                          tampered?.seq === r.seq && "text-signal-red font-bold",
                        )}
                        title={`prev ${r.prev.slice(0, 8)}…`}
                      >
                        {tampered?.seq === r.seq ? "seal broken" : `${r.hash.slice(0, 8)}…`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ProbeChart({ detail }: { detail: RunDetail }) {
  const pts = detail.probe;
  if (pts.length === 0) return <p className="mt-2 text-[11px] text-muted-foreground">no probe records</p>;

  const W = 1000;
  const H = 72;
  const bw = W / pts.length;
  const t0 = pts[0].tSendNs;
  const tEnd = pts[pts.length - 1].tSendNs;
  const latMax = Math.max(6, ...pts.filter((p) => p.ok).map((p) => p.latencyMs ?? 0));

  // outage band: first fail streak after the fault
  const faultNs = Date.parse(detail.run.tFaultIso ?? "") * 1e6;
  const xOf = (ns: number) => ((ns - t0) / Math.max(1, tEnd - t0)) * W;

  let band: { x1: number; x2: number } | null = null;
  const firstFail = pts.find((p) => !p.ok && p.tSendNs >= faultNs - 50e6);
  if (firstFail) {
    const next = pts.find((p) => p.ok && p.tSendNs > firstFail.tSendNs);
    band = { x1: xOf(firstFail.tSendNs), x2: next ? xOf(next.tSendNs) : W };
  }

  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-20 w-full border-b border-border" role="img" aria-label="Probe results across the run">
        {band && (
          <rect x={band.x1} y={0} width={Math.max(1, band.x2 - band.x1)} height={H} fill="var(--signal-red)" opacity={0.12} />
        )}
        <line
          x1={xOf(faultNs)}
          x2={xOf(faultNs)}
          y1={0}
          y2={H}
          stroke="var(--signal-red)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
        {pts.map((p) => {
          const x = (p.seq - pts[0].seq) * bw;
          if (p.ok) {
            const h = Math.max(2, ((p.latencyMs ?? 2) / latMax) * (H - 8));
            return <rect key={p.seq} x={x} y={H - h} width={Math.max(1.5, bw - 0.8)} height={h} fill="var(--signal-green)" opacity={0.85} />;
          }
          return (
            <rect
              key={p.seq}
              x={x}
              y={0}
              width={Math.max(1.5, bw - 0.8)}
              height={H}
              fill={p.status === 503 ? "var(--caution)" : "var(--signal-red)"}
              opacity={0.9}
            />
          );
        })}
      </svg>
      <p className="plate mt-1">
        fault marked with a dashed line · red band = outage (first failed request → first success) · amber = 503 fail closed
      </p>
    </div>
  );
}

function Head({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className="panel-flat px-3 py-2">
      <p className="plate">{k}</p>
      <p className={cn("telemetry mt-0.5 text-sm font-bold", cls)}>{v}</p>
    </div>
  );
}
