"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useLabStore } from "@/store/lab-store";
import { cn } from "@/lib/utils";

/** Sticky invariants bar — the baseplate of the console. */
export function InvariantsBar() {
  const policy = useLabStore((s) => s.policy);
  const runId = useLabStore((s) => s.runId);
  const violations = useLabStore((s) => s.safetyViolations);
  const { theme, setTheme } = useTheme();

  return (
    <footer className="mt-auto border-t-2 border-foreground bg-card">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 sm:px-6">
        <p className="text-[11px] leading-snug">
          <span className="font-bold">Fail closed.</span>{" "}
          <span className="text-muted-foreground">
            When no replica passes policy, clients get 503 — never a wrong-country or weak-TLS hop.
          </span>
        </p>
        <p className="telemetry text-[11px]">
          <span className="text-muted-foreground">requests to non-compliant replicas</span>{" "}
          <span className={cn("font-bold", violations > 0 ? "text-signal-red" : "text-signal-green")}>{violations}</span>
        </p>
        <p className="telemetry hidden text-[11px] text-muted-foreground md:inline">
          policy <span className="font-semibold text-foreground">{policy ? `${policy.id} · ${policy.sha}` : "—"}</span>
        </p>
        <p className="telemetry hidden text-[11px] text-muted-foreground md:inline">
          run <span className="font-semibold text-foreground">{runId}</span>
        </p>
        <p className="telemetry hidden text-[11px] text-muted-foreground lg:inline">
          downtime resolution = probe interval, ±50 ms
        </p>
        <p className="hidden text-[11px] text-muted-foreground xl:inline">
          Location labels are configured, certificate-attested claims — not geolocation.
        </p>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="ml-auto flex min-h-9 items-center gap-1.5 border-1.5 border-foreground bg-card px-2.5 text-[11px] font-bold hover:bg-muted"
          aria-label={theme === "dark" ? "switch to daylight panel" : "switch to night panel"}
        >
          {theme === "dark" ? <Sun className="size-3.5" aria-hidden /> : <Moon className="size-3.5" aria-hidden />}
          {theme === "dark" ? "Daylight" : "Night shift"}
        </button>
      </div>
    </footer>
  );
}
