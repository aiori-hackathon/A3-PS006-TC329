# 10 — Development Phases

The build was executed in this order; each phase has an exit criterion that was checked before moving on. (This document describes the implemented reality, not a wishlist.)

---

## Phase 0 — Specification (this docs set)
**Deliverable:** 12 spec files under `docs/`, shared worklog initialized.
**Exit:** all contracts (API, DB, WS, scoring) frozen; design plan (palette, type, layout, motion) fixed.

## Phase 1 — Data layer
- Prisma schema (`PolicyFile`, `Run`, `AuditEvent`, `ProbeRecord`, `ScoreComponent`), `db:push`.
- **Exit:** schema pushes cleanly to `db/custom.db`.

## Phase 2 — Engine core (pure modules first)
- `models.ts`, `policy.ts`, `health.ts`, `audit.ts`, `analyze.ts`, `scoring.ts` — all pure or self-contained, hand-verified against the reference implementation's 52-test expectations (rule short-circuits, reason ordering, chain tampering, outage math, percentile ranks).
- **Exit:** evaluate() reproduces the PRD matrix outcomes for all six profiles; chain detects edits/deletions.

## Phase 3 — Engine runtime (timers + state)
- `replicas.ts` (simulation + timing model), `observer.ts`, `monitor.ts`, `manager.ts`, `probe.ts`, `runner.ts`, `engine.ts` (singleton, publisher, persistence, snapshot).
- **Exit:** crash → failover and crash-with-bad-B → refusal both work from a single `curl` against the API; epoch, audit order and probe windows match the reference end-to-end runs.

## Phase 4 — API surface
- 16 route handlers with zod validation, run lock (409), structured errors.
- **Exit:** every endpoint in doc 06 answers its contract; lint clean.

## Phase 5 — Realtime bridge
- `mini-services/realtime`: socket.io on 3033 (path `/`), token-gated `/publish`, batched events; started with `bun run dev` in background.
- Engine publisher: coalesced 40 ms flushes, 500 ms timeout, silent failure.
- **Exit:** browser receives `lab` batches through the gateway (`/?XTransformPort=3033`); killing the bridge leaves the console functional on polling.

## Phase 6 — Frontend
- Design tokens + fonts (Overpass / Martian Mono) + panel utilities; fascia, route diagram hero, station cards, controls, telemetry strip, audit tape, four sections, footer bar; zustand store + socket hook + REST fallback.
- **Exit:** console renders from live engine data on first paint; all four sections functional; responsive at 375 / 768 / 1280 px.

## Phase 7 — Verification & polish
- Agent-browser end-to-end pass: snapshot render, crash inject → failover, refusal path, scenario S1 + S3 batches, policy validate/reload, records detail, chain verify, footer sticky behavior, mobile width.
- `bun run lint` clean; `dev.log` free of runtime errors; worklog updated by every agent.
- **Exit:** golden paths browser-verified (doc 12 runbook).

## Rebuild / extend notes

- To swap the simulation for real containers: implement `replicas.ts` + `observer.ts` against real HTTPS endpoints (URLs from config); nothing else changes — the manager, audit, scoring and UI are transport-agnostic by construction.
- To add rules (R7+): extend the policy schema in `policy.ts`, add evaluation in rule order, extend reason enum in doc 06 — UI reason badges render generically.
