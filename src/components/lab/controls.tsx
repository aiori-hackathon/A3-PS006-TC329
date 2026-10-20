"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { api } from "@/lib/lab-api";
import { PROFILE_KEYS, PROFILE_LABEL, type ReplicaId } from "@/lib/lab-types";
import { useLabStore } from "@/store/lab-store";
import { cn } from "@/lib/utils";

/** Fault injectors, Replica B profile, manual switch, run reset — the operator levers. */

const FAULTS = [
  { key: "CRASH", label: "Crash", hint: "kill the process" },
  { key: "LINK_LOSS", label: "Link loss", hint: "drop all packets" },
  { key: "OVERLOAD", label: "Overload", hint: "2500 ms degrade" },
] as const;

async function resync(): Promise<void> {
  try {
    useLabStore.getState().applySnapshot(await api.state());
  } catch {
    /* the stream or the next poll repaints */
  }
}

export function Controls() {
  const replicas = useLabStore((s) => s.replicas);
  const runLock = useLabStore((s) => s.runLock);
  const active = useLabStore((s) => s.active);
  const runId = useLabStore((s) => s.runId);
  const [target, setTarget] = useState<ReplicaId>("A");
  const [profile, setProfile] = useState<string>("compliant");
  const [busy, startTransition] = useTransition();
  const [pending, setPending] = useState(false);

  const b = replicas.find((r) => r.id === "B");
  const anyFault = replicas.some((r) => r.fault);
  const disabled = runLock || busy || pending || replicas.length === 0;

  const run = async (label: string, fn: () => Promise<void>) => {
    setPending(true);
    try {
      await fn();
      await resync();
      startTransition(() => undefined);
    } catch (err) {
      toast.error(label, { description: (err as Error).message });
    } finally {
      setPending(false);
    }
  };

  const injectFault = (fault: string) =>
    run("Fault injector", async () => {
      await api.fault(target, fault, "inject");
      toast(`Fault injected on ${target}`, { description: `${fault.replace("_", " ")} — watch the tape` });
    });

  const clearFaults = () =>
    run("Clear faults", async () => {
      const withFaults = replicas.filter((r) => r.fault);
      for (const r of withFaults) await api.fault(r.id, r.fault!, "clear");
      toast("Faults cleared", { description: withFaults.length ? withFaults.map((r) => r.id).join(", ") + " restored" : "nothing to clear" });
    });

  const applyProfile = () =>
    run("Apply profile", async () => {
      await api.profile(profile);
      toast(`Replica B recreated as ${PROFILE_LABEL[profile] ?? profile}`, {
        description: "standby only — the route never moves to it without a PASS",
      });
    });

  const manualSwitch = (to: ReplicaId) =>
    run("Manual switch", async () => {
      const res = await api.switch(to);
      if (res.result === "SWITCHED") {
        toast.success(`Route switched to ${to}`, { description: `epoch ${res.epoch} — gate passed` });
      } else if (res.result === "REFUSED") {
        toast.error(`Switch to ${to} refused`, {
          description: res.reasons.join(" + ") || "candidate unreachable",
        });
      } else {
        toast(`${to} is already on route`, { description: "no change" });
      }
    });

  const resetRun = () =>
    run("Reset run", async () => {
      const res = await api.reset();
      toast(`Fresh run ${res.runId}`, { description: "faults cleared, A re-gated, epoch 0, new audit chain" });
    });

  return (
    <article className="panel min-w-0 p-4" aria-label="Operator controls">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold tracking-wide">Controls</h2>
        <span className="plate">gated actions only</span>
      </div>

      {runLock && (
        <p className="mt-2 border border-caution bg-caution-soft px-2.5 py-1.5 text-[11px] font-semibold text-caution">
          Scenario batch running — manual changes are locked until it finishes or is cancelled.
        </p>
      )}

      {/* Fault injectors */}
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">target</span>
          <div className="flex border-1.5 border-foreground" role="group" aria-label="Fault target">
            {(["A", "B"] as const).map((rid) => (
              <button
                key={rid}
                type="button"
                disabled={disabled}
                onClick={() => setTarget(rid)}
                aria-pressed={target === rid}
                className={cn(
                  "min-h-9 min-w-10 px-2 text-xs font-bold",
                  target === rid ? "bg-foreground text-background" : "hover:bg-muted",
                )}
              >
                {rid}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {FAULTS.map((f) => (
            <button
              key={f.key}
              type="button"
              disabled={disabled}
              onClick={() => injectFault(f.key)}
              title={f.hint}
              className="min-h-11 border-1.5 border-foreground bg-card px-2 text-xs font-bold hover:bg-signal-red hover:text-white hover:border-signal-red disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={disabled || !anyFault}
          onClick={clearFaults}
          className="mt-2 min-h-9 w-full border-1.5 border-foreground bg-card px-2 text-xs font-bold hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
        >
          Clear all faults
        </button>
      </div>

      {/* Replica B profile */}
      <div className="mt-4 border-t border-border pt-3">
        <label htmlFor="b-profile" className="text-[11px] text-muted-foreground">
          Replica B profile <span className="telemetry">(now: {b ? PROFILE_LABEL[b.profile] ?? b.profile : "—"})</span>
        </label>
        <div className="mt-1.5 flex gap-2">
          <select
            id="b-profile"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            disabled={disabled}
            className="telemetry h-10 flex-1 border-1.5 border-foreground bg-card px-2 text-xs"
          >
            {PROFILE_KEYS.map((p) => (
              <option key={p} value={p}>
                {PROFILE_LABEL[p]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={disabled}
            onClick={applyProfile}
            title="Recreates replica B with the chosen profile (standby only)"
            className="min-h-10 border-1.5 border-foreground bg-card px-3 text-xs font-bold hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
          >
            Apply
          </button>
        </div>
        {active === "B" && (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            B is on route — a profile change needs B on standby (reset the run or switch back first).
          </p>
        )}
      </div>

      {/* Manual switch */}
      <div className="mt-4 border-t border-border pt-3">
        <span className="text-[11px] text-muted-foreground">manual switch — still policy-gated</span>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={disabled || active === "A"}
            onClick={() => manualSwitch("A")}
            className="min-h-10 border-1.5 border-foreground bg-card px-2 text-xs font-bold hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
          >
            Switch to A
          </button>
          <button
            type="button"
            disabled={disabled || active === "B"}
            onClick={() => manualSwitch("B")}
            className="min-h-10 border-1.5 border-foreground bg-card px-2 text-xs font-bold hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
          >
            Switch to B
          </button>
        </div>
      </div>

      {/* Reset */}
      <div className="mt-4 border-t border-border pt-3">
        <button
          type="button"
          disabled={disabled}
          onClick={resetRun}
          title="New run id, faults cleared, fresh audit chain, epoch 0"
          className="min-h-10 w-full bg-foreground px-2 text-xs font-bold text-background hover:bg-ink-soft disabled:opacity-40 disabled:pointer-events-none"
        >
          Reset run
        </button>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          current run <span className="telemetry">{runId}</span> — evidence stays in Records
        </p>
      </div>
    </article>
  );
}
