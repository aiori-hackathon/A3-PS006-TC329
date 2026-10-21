# 07 — Repository Structure

The repo is the Next.js project itself (single package for the app) plus one independent Bun mini-service and the spec docs. Paths are relative to the repository root.

```
interlock-control-room/
├── docs/                                # system architecture, PRD, design and engineering specs
│   ├── Architecture.md                  # architectural drivers, trust boundaries, components
│   ├── MVP Tech Doc.md                  # MVP technical specification and implementation plan
│   ├── PRD.md                           # product requirements document
│   ├── System Design.md                 # system design, protocols, and data models
│   ├── AIORI3_PS006_Algo-Ancesstors.pdf # team presentation & submission document
│   ├── Proposed-structure-hackathon.pdf # hackathon template guidance
│   ├── 01-product-requirements.md
│   ├── 02-user-stories-and-acceptance-criteria.md
│   ├── 03-information-architecture.md
│   ├── 04-system-architecture.md
│   ├── 05-database-schema.md
│   ├── 06-api-contracts.md
│   ├── 07-monorepo-structure.md
│   ├── 08-scoring-engine-spec.md
│   ├── 09-engineering-scope-definition.md
│   ├── 10-development-phases.md
│   ├── 11-environment-and-devops.md
│   └── 12-testing-strategy.md
├── prisma/schema.prisma                 # models: PolicyFile, Run, AuditEvent, ProbeRecord, ScoreComponent
├── db/custom.db                         # SQLite file (ignored by git)
├── mini-services/
│   └── realtime/                        # independent Bun project (port 3033)
│       ├── package.json                 # deps: socket.io; dev: bun --hot index.ts
│       ├── index.ts                      # socket.io (path "/") + POST /publish (token)
│       └── README.md
├── src/
│   ├── app/
│   │   ├── page.tsx                     # the only route: INTERLOCK console
│   │   ├── layout.tsx                   # fonts (Overpass, Martian Mono), ThemeProvider, Toaster
│   │   ├── globals.css                  # design tokens (signal-box palette) + panel utilities
│   │   └── api/
│   │       ├── lab/state/route.ts
│   │       ├── lab/fault/route.ts
│   │       ├── lab/profile/route.ts
│   │       ├── lab/switch/route.ts
│   │       ├── lab/reset/route.ts
│   │       ├── policy/route.ts
│   │       ├── policy/validate/route.ts
│   │       ├── policy/reload/route.ts
│   │       ├── audit/route.ts
│   │       ├── audit/verify/route.ts
│   │       ├── runs/route.ts
│   │       ├── runs/[runId]/route.ts
│   │       ├── analytics/matrix/route.ts
│   │       ├── scenario/start/route.ts
│   │       ├── scenario/status/route.ts
│   │       └── scenario/cancel/route.ts
│   ├── server/lab/                      # the engine (server-only, never imported by client code)
│   │   ├── models.ts
│   │   ├── policy.ts                    # pure: parse, validate, hash, evaluate (R1–R6)
│   │   ├── health.ts                    # pure: HealthTracker
│   │   ├── audit.ts                     # chain + verifier
│   │   ├── analyze.ts                   # pure: outages, percentiles
│   │   ├── scoring.ts                   # pure: C1–C6, grades
│   │   ├── replicas.ts                  # simulated replicas + faults + timing model
│   │   ├── observer.ts                  # Observation via tolerant "TLS" view
│   │   ├── monitor.ts                   # health loops + classification
│   │   ├── manager.ts                   # failover state machine (single route writer)
│   │   ├── probe.ts                     # front door + fixed-schedule probe
│   │   ├── runner.ts                    # scenario batch sequencer
│   │   └── engine.ts                    # singleton, publisher, persistence, snapshot
│   ├── components/
│   │   ├── lab/                         # console primitives
│   │   │   ├── header.tsx               # fascia + section tabs + live-link lamp
│   │   │   ├── route-diagram.tsx        # SVG hero (the signature element)
│   │   │   ├── station-cards.tsx        # controller + replica panels
│   │   │   ├── controls.tsx             # faults, profile, switch, reset
│   │   │   ├── telemetry.tsx            # probe strip chart + downtime readout
│   │   │   ├── audit-tape.tsx           # streaming audit feed
│   │   │   └── footer.tsx               # sticky invariants bar
│   │   └── sections/
│   │       ├── console-section.tsx
│   │       ├── scenarios-section.tsx
│   │       ├── policy-section.tsx
│   │       └── records-section.tsx
│   ├── hooks/
│   │   └── use-lab-socket.ts            # socket.io lifecycle → store
│   ├── store/lab-store.ts               # zustand: snapshot, rings, run status, connection
│   ├── lib/
│   │   ├── lab-types.ts                 # shared client types (mirror doc 06)
│   │   ├── lab-api.ts                   # typed fetch helpers
│   │   ├── lab-socket.ts                # socket singleton + channel "lab"
│   │   └── db.ts                        # Prisma client (scaffold)
│   └── components/ui/                   # shadcn/ui (scaffold; themed via tokens)
├── tests/                               # unit & integration test suites
├── scripts/                             # build & deployment automation scripts
├── Caddyfile                            # zero-trust gateway reverse proxy
└── package.json                         # app scripts (dev on 3000, build, test, lint)
```

## Conventions

- Server-only engine code under `src/server/**` is never imported from client components — client code speaks only to `/api/*` and the WS bridge.
- The engine singleton is stored on `globalThis` (`INTERLOCK_ENGINE`) so Next.js dev HMR cannot spawn duplicate timer sets; on re-creation old timers are disposed first.
- One shared type surface: `src/lib/lab-types.ts` (client) mirrors `src/server/lab/models.ts` (server) — the API contract in doc 06 is the source of truth.
- `docs/` is human documentation; no runtime dependency.
