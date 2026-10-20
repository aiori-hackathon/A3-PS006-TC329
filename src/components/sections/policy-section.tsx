"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/lab-api";
import { useLabStore } from "@/store/lab-store";
import { cn } from "@/lib/utils";
import type { PolicySummary } from "@/lib/lab-types";

/** Section 3 — Policy Studio: YAML editor, validation, reload, parsed rules, history. */

export function PolicySection() {
  const policy = useLabStore((s) => s.policy);
  const runLock = useLabStore((s) => s.runLock);
  const [yaml, setYaml] = useState<string>("");
  const [history, setHistory] = useState<{ sha: string; atIso: string; active: boolean }[]>([]);
  const [validation, setValidation] = useState<
    { state: "idle" } | { state: "valid"; sha: string } | { state: "invalid"; error: string }
  >({ state: "idle" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .policy()
      .then((res) => {
        setYaml(res.yaml);
        setHistory(res.history);
      })
      .catch((err) => toast.error("Could not load policy", { description: (err as Error).message }));
  }, []);

  const validate = async () => {
    setBusy(true);
    try {
      const res = await api.validatePolicy(yaml);
      setValidation(res.valid ? { state: "valid", sha: res.sha ?? "" } : { state: "invalid", error: res.error ?? "invalid" });
    } catch (err) {
      setValidation({ state: "invalid", error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setBusy(true);
    try {
      const res = await api.reloadPolicy(yaml);
      if (res.ok) {
        toast.success(`Policy ${res.sha} loaded`, { description: "the gate uses it from the next evaluation on" });
        setValidation({ state: "valid", sha: res.sha ?? "" });
        const p = await api.policy();
        setHistory(p.history);
      } else {
        toast.error("Reload refused", {
          description: `${res.error} — the previous policy stays active`,
        });
        setValidation({ state: "invalid", error: res.error ?? "invalid" });
      }
    } catch (err) {
      toast.error("Reload failed", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const parsed = policy as (PolicySummary & { yaml?: string }) | null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      {/* Editor */}
      <section className="panel p-4" aria-label="Policy editor">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold tracking-wide">policy.yaml</h2>
          <span className="telemetry text-[11px] text-muted-foreground">
            active: <span className="font-bold text-foreground">{parsed ? `${parsed.id} · ${parsed.sha}` : "—"}</span>
          </span>
        </div>

        {runLock && (
          <p className="mt-2 border border-caution bg-caution-soft px-2.5 py-1.5 text-[11px] font-semibold text-caution">
            Scenario batch running — reloads are locked until it finishes.
          </p>
        )}

        <textarea
          value={yaml}
          onChange={(e) => {
            setYaml(e.target.value);
            setValidation({ state: "idle" });
          }}
          spellCheck={false}
          rows={16}
          aria-label="Policy YAML"
          className="telemetry mt-2 w-full resize-y border-1.5 border-foreground bg-popover p-3 text-xs leading-relaxed"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={validate}
            disabled={busy}
            className="min-h-10 border-1.5 border-foreground bg-card px-4 text-xs font-bold hover:bg-muted disabled:opacity-50"
          >
            {busy ? "…" : "Validate"}
          </button>
          <button
            type="button"
            onClick={reload}
            disabled={busy || runLock}
            className="min-h-10 bg-foreground px-4 text-xs font-bold text-background hover:bg-ink-soft disabled:opacity-40"
          >
            Reload policy
          </button>
          {validation.state === "valid" && (
            <span className="telemetry bg-signal-green-soft px-2 py-1 text-[11px] font-bold text-signal-green">
              valid — sha {validation.sha}
            </span>
          )}
          {validation.state === "invalid" && (
            <span className="telemetry max-w-full truncate border border-signal-red bg-signal-red-soft px-2 py-1 text-[11px] font-semibold text-signal-red" title={validation.error}>
              {validation.error}
            </span>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          An invalid reload never replaces the active policy — the failure is audited as{" "}
          <span className="telemetry">policy_load_failed</span> and the old gate keeps deciding.
        </p>
      </section>

      {/* Parsed rules + history */}
      <div className="grid content-start gap-4">
        <section className="panel p-4" aria-label="Active policy rules">
          <h2 className="text-sm font-bold tracking-wide">Gate as loaded</h2>
          <div className="mt-2 border-t border-border pt-2 telemetry text-[11px]">
            <Line k="R1 · reachable" v="TLS handshake + /meta within 500 ms" />
            <Line k="R2 · trusted certificate" v="lab CA, host name, validity" />
            <Line
              k="R3 · location allowed"
              v={parsed ? `declared ∈ { ${parsed.allowedLocations.join(", ")} }` : "—"}
            />
            <Line k="R4 · label ⇔ certificate" v={parsed?.requireCertLabelMatch ? "must match the SAN label" : "off"} />
            <Line
              k="R5 · TLS baseline"
              v={parsed ? `≥ ${parsed.minVersion} (${parsed.enforcement})` : "—"}
            />
            <Line
              k="R6 · minimal logging"
              v={parsed?.requireMinimalLogging ? "replica must declare minimal" : "off"}
            />
          </div>
          <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
            Same input, same decision — evaluation is a pure function; order of reason codes is fixed R1→R6.
            Replays are stored per run and scored (C6).
          </p>
        </section>

        <section className="panel p-4" aria-label="Policy history">
          <h2 className="text-sm font-bold tracking-wide">Loaded policies</h2>
          <div className="mt-2 max-h-48 overflow-y-auto tape-scroll border-t border-border telemetry text-[11px]">
            {history.length === 0 && <p className="py-3 text-muted-foreground">no reloads recorded yet</p>}
            {history.map((h) => (
              <div key={h.sha + h.atIso} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1 last:border-0">
                <span className={cn("font-semibold", h.active ? "text-signal-green" : "text-foreground")}>
                  {h.sha}
                  {h.active && <span className="ml-2 text-[10px] uppercase text-signal-green">active</span>}
                </span>
                <span className="text-muted-foreground">{h.atIso.replace("T", " ").slice(0, 19)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-semibold">{v}</span>
    </div>
  );
}
