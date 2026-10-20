# 03 — Information Architecture

One route only: `/` (rendered by `src/app/page.tsx`). Everything is a client-side **panel section** of the console, reached through a panel-tab strip styled like signal-box push-buttons. Deep information (run details) opens in a right-side sheet, not a new route.

---

## Navigation model

```
┌──────────────────────────────────────────────────────────────────────┐
│ FASCIA  INTERLOCK · policy-constrained failover · [MODE] epoch UTC  │
│         [Console] [Scenarios] [Policy] [Records]      live-link lamp │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   section body (see below)                                           │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ FOOTER (sticky): fail-closed note · served-by-noncompliant=0 ·       │
│ policy id/sha · run id · chain status · probe resolution ±50 ms      │
└──────────────────────────────────────────────────────────────────────┘
```

## Section 1 — Console (default)

```
┌────────────────────────────────────────────────────────────────────┐
│ ROUTE DIAGRAM (hero): probe ── controller ──▶ A (route set)          │
│                                        └──▶ B (interlock × reasons) │
│ state-machine strip: STARTING · SERVING · EVALUATING · UNAVAILABLE   │
├───────────────────────────────┬────────────────────────────────────┤
│ CONTROLLER PANEL              │ FAULT & SWITCH CONTROLS             │
│ mode, epoch, run id, policy   │ target A/B, crash/linkloss/overload │
│ id+sha, health params         │ clear faults, B profile select,     │
│                               │ manual switch (gated), reset run    │
├───────────────────────────────┴────────────────────────────────────┤
│ REPLICA STATIONS:  [ A card ]              [ B card ]                │
│  lamp, health, last reason/latency, profile facts, last decision     │
├────────────────────────────────────────────────────────────────────┤
│ PROBE STRIP CHART: rolling 120 probes (tick marks + latency trace)   │
│ downtime readout · ok-rate · rate/s                                   │
├────────────────────────────────────────────────────────────────────┤
│ AUDIT TAPE: streaming hash-chained events, newest on top,            │
│ pause on hover · verify-chain button · run selector                 │
└────────────────────────────────────────────────────────────────────┘
```

## Section 2 — Scenarios

- Runner: scenario select (S1–S9 with expected outcome), repeats (1–10), Start/Cancel; live phase + progress + current repeat.
- Scenario cards grid: per-scenario stats (runs, pass rate, downtime mean/p50/p95, mean detect, best grade, invariant flag).
- Locked-state banner when a batch is running (manual controls disabled across the app).

## Section 3 — Policy

- Left: YAML editor (textarea, fixed mono), Validate and Reload buttons, diff-of-hash readout.
- Right: parsed rules card (allowed locations, TLS min/enforcement, label-match, logging), policy history (`policy_loaded` events with hashes).
- Failures show the exact validation error inline; invalid reload never replaces the active policy.

## Section 4 — Records

- Runs table: run id, scenario, B profile, outcome, reasons, downtime, detect/decide/switch ms, score, grade, chain ✓, invariant 0.
- Row opens a detail sheet: merged timeline (offsets from fault), probe chart with outage band, score breakdown (C1–C6 with points/note), audit table with chain verify button, determinism replay readout.
- Matrix summary across scenarios (same numbers as section 2, from `/api/analytics/matrix`).

## States to design for

| State | Treatment |
|---|---|
| First load (no WS yet) | REST snapshot paints the console; skeleton panels with panel frames, never blank |
| WS connected / disconnected | Small lamp in fascia: "LIVE LINK" green vs "POLLING" amber; disconnection → 1 s REST polling |
| Scenario running | Run-lock banner; Controls section disabled with explanatory plate |
| Empty records | "No runs recorded yet. Start a scenario from the Scenarios panel." with a button that switches sections |
| Audit empty (fresh run) | Tape shows the genesis events (controller_started, policy_loaded) |
| Errors (409/400) | Toast with the server's message; no silent failures |

## Responsive behavior

- ≥ 1024 px: two-column console grid, scenario cards 3-up.
- 640–1024 px: single column, route diagram scales (SVG viewBox), controls stack.
- < 640 px: horizontal scroll only inside data tables (audit tape keeps fixed columns), touch targets ≥ 44 px, footer wraps to two lines.
