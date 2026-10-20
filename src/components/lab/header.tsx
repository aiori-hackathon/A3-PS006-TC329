"use client";

import { useEffect, useRef, useState } from "react";
import { useLabStore } from "@/store/lab-store";
import { cn } from "@/lib/utils";
import type { Mode } from "@/lib/lab-types";

export type SectionKey = "console" | "scenarios" | "policy" | "records";

const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: "console", label: "Console", hint: "Live lab, faults, route" },
  { key: "scenarios", label: "Scenarios", hint: "S1–S9 batches and stats" },
  { key: "policy", label: "Policy", hint: "YAML gate" },
  { key: "records", label: "Records", hint: "Runs, scores, audit" },
];

const MODE_META: Record<Mode, { label: string; cls: string }> = {
  STARTING: { label: "Starting", cls: "bg-muted text-foreground" },
  SERVING: { label: "Serving", cls: "bg-signal-green text-white" },
  EVALUATING: { label: "Evaluating", cls: "bg-caution text-white" },
  UNAVAILABLE: { label: "Fail closed", cls: "bg-signal-red text-white" },
};

/** Minimal operator auth status badge + login popover */
function OperatorBadge() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => r.json() as Promise<{ authenticated: boolean }>)
      .then((d) => setAuthed(d.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        setAuthed(true);
        setOpen(false);
        setKey("");
      } else {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? "Login failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setAuthed(false);
  }

  if (authed === null) return null;

  return (
    <div className="relative">
      <button
        type="button"
        title={authed ? "Operator authenticated — click to log out" : "Operator login"}
        aria-label={authed ? "Operator authenticated" : "Operator login"}
        onClick={() => (authed ? handleLogout() : setOpen((o) => !o))}
        className={cn(
          "flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider transition-colors",
          authed ? "text-signal-green" : "text-fascia-ink/55 hover:text-fascia-ink",
        )}
      >
        <span aria-hidden>{authed ? "🔒" : "🔓"}</span>
        <span className="hidden sm:inline">{authed ? "operator" : "login"}</span>
      </button>

      {open && !authed && (
        <form
          onSubmit={handleLogin}
          className="absolute right-0 top-full z-50 mt-1 flex w-64 flex-col gap-2 rounded border border-white/20 bg-fascia p-3 shadow-lg"
        >
          <label className="text-xs font-semibold uppercase tracking-wider text-fascia-ink/70">
            Admin key
          </label>
          <input
            ref={inputRef}
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Enter key…"
            className="rounded border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-fascia-ink outline-none placeholder:text-fascia-ink/40 focus:border-white/50"
            autoComplete="current-password"
          />
          {error && <span className="text-xs text-signal-red">{error}</span>}
          <button
            type="submit"
            disabled={busy || !key}
            className="rounded bg-fascia-ink/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-fascia-ink transition hover:bg-fascia-ink/30 disabled:opacity-40"
          >
            {busy ? "Authenticating…" : "Authenticate"}
          </button>
        </form>
      )}
    </div>
  );
}

export function Fascia({
  section,
  onSection,
}: {
  section: SectionKey;
  onSection: (s: SectionKey) => void;
}) {
  const mode = useLabStore((s) => s.mode);
  const epoch = useLabStore((s) => s.epoch);
  const active = useLabStore((s) => s.active);
  const connected = useLabStore((s) => s.connected);
  const runLock = useLabStore((s) => s.runLock);
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setClock(new Date().toISOString().slice(11, 23) + "Z");
    tick();
    const id = setInterval(tick, 87);
    return () => clearInterval(id);
  }, []);

  const meta = MODE_META[mode];

  return (
    <header className="bg-fascia text-fascia-ink sticky top-0 z-40">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-extrabold tracking-[0.22em] uppercase">Interlock</span>
          <span className="hidden text-[11px] text-fascia-ink/60 sm:inline">
            policy-constrained failover · PS-006
          </span>
        </div>

        <div className="flex items-center gap-3 telemetry text-xs">
          <span
            className={cn(
              "px-2 py-0.5 font-semibold uppercase tracking-wider",
              mode === "UNAVAILABLE" && "lamp-pulse",
              meta.cls,
            )}
            aria-label={`controller mode ${meta.label}`}
          >
            {meta.label}
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <span className="text-fascia-ink/60">route</span>
            <span className="font-bold">{active ?? "—"}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-fascia-ink/60">epoch</span>
            <span className="font-bold">{epoch}</span>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-4 telemetry text-xs">
          {runLock && (
            <span className="hidden bg-caution px-2 py-0.5 font-semibold uppercase tracking-wider text-white sm:inline">
              batch running
            </span>
          )}
          <span
            className="flex items-center gap-1.5"
            title={connected ? "socket.io stream connected" : "polling REST fallback"}
          >
            <span
              className={cn("lamp", connected ? "lamp-green" : "lamp-amber", !connected && "lamp-pulse")}
              aria-hidden
            />
            <span className="text-fascia-ink/70">{connected ? "live link" : "polling"}</span>
          </span>
          <span className="hidden text-fascia-ink/70 md:inline">{clock}</span>
          <OperatorBadge />
        </div>
      </div>

      <nav aria-label="Console sections" className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1440px] gap-0 px-4 sm:px-6">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSection(s.key)}
              aria-current={section === s.key ? "page" : undefined}
              title={s.hint}
              className={cn(
                "min-h-11 border-b-2 px-3.5 py-2 text-sm font-semibold transition-colors sm:px-5",
                section === s.key
                  ? "border-b-fascia-ink bg-fascia-ink/10 text-fascia-ink"
                  : "border-b-transparent text-fascia-ink/55 hover:text-fascia-ink",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </nav>
    </header>
  );
}
